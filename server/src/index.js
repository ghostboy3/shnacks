const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const dotenv = require("dotenv");
const { OpenAI } = require("openai");

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

// Simple in-memory store for prototype: { userId: { chunks: [...], vectors: [...] } }
const userStores = new Map();

// OpenAI client (optional). If no key, AI features will be disabled but uploads will still work.
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

/**
 * Helper: chunk text into overlapping segments for retrieval
 */
function chunkText(text, chunkSize = 1200, overlap = 200) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end);
    chunks.push(chunk);
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

/**
 * Helper: cosine similarity
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Upload PDFs, extract text, embed chunks and store them per user.
 * Expects headers: x-user-id (from Firebase auth on the client)
 */
app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId) {
      return res.status(400).json({ error: "Missing x-user-id header" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    let combinedText = "";

    for (const file of req.files) {
      const data = await pdfParse(file.buffer);
      if (data && data.text) {
        combinedText += `\n\n[FILE: ${file.originalname}]\n` + data.text;
      }
    }

    const chunks = combinedText ? chunkText(combinedText) : [];

    let vectors = [];
    // Create embeddings if OpenAI is available
    if (openai && chunks.length > 0) {
      try {
        const embeddingsResponse = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: chunks
        });
        vectors = embeddingsResponse.data.map((d) => d.embedding);
      } catch (embedErr) {
        console.error("Failed to create embeddings:", embedErr);
        // Continue without embeddings - chat will use text-based search
      }
    }

    userStores.set(userId, {
      chunks,
      vectors
    });

    res.json({
      message: vectors.length > 0 
        ? "PDFs uploaded and indexed successfully for AI chat."
        : "PDFs uploaded successfully. Text stored (embeddings not created - OpenAI may not be configured).",
      chunkCount: chunks.length
    });
  } catch (err) {
    console.error("Error in /api/upload", err);
    res.status(500).json({ error: "Failed to process PDFs" });
  }
});

/**
 * Helper: simple text-based relevance scoring (keyword matching)
 */
function scoreChunksByText(chunks, query) {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  
  return chunks.map((chunk, idx) => {
    const chunkLower = chunk.toLowerCase();
    let score = 0;
    queryWords.forEach(word => {
      const matches = (chunkLower.match(new RegExp(word, 'g')) || []).length;
      score += matches;
    });
    return { idx, score };
  });
}

/**
 * Chat endpoint: Socratic T2DM tutor using only PDF-derived context.
 *
 * Body:
 * {
 *   userId: string,
 *   messages: [{ role: "user" | "assistant", content: string }],
 *   mode: "questions" | "feedback"
 * }
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { userId, messages, mode } = req.body || {};

    if (!openai) {
      return res.status(503).json({
        error: "AI chat is not configured. Set OPENAI_API_KEY on the server to enable Socratic tutor."
      });
    }
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Missing messages" });
    }

    const store = userStores.get(userId);
    if (!store || !store.chunks || store.chunks.length === 0) {
      return res
        .status(400)
        .json({ error: "No PDF knowledge found for this user. Please upload PDFs first." });
    }

    const latestUserMessage = [...messages].reverse().find((m) => m.role === "user");
    if (!latestUserMessage) {
      return res.status(400).json({ error: "No user message found" });
    }

    let contextPieces = [];
    
    // Use embeddings if available, otherwise fall back to text-based search
    if (store.vectors && store.vectors.length > 0) {
      // Embed latest user message for retrieval
      const queryEmbeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: latestUserMessage.content
      });
      const queryVector = queryEmbeddingResponse.data[0].embedding;

      // Score chunks using embeddings
      const scored = store.vectors.map((vec, idx) => ({
        idx,
        score: cosineSimilarity(queryVector, vec)
      }));

      scored.sort((a, b) => b.score - a.score);
      const topK = scored.slice(0, 6);
      contextPieces = topK
        .filter((s) => s.score > 0)
        .map((s) => store.chunks[s.idx]);
    } else {
      // Fallback: simple text-based keyword matching
      const scored = scoreChunksByText(store.chunks, latestUserMessage.content);
      scored.sort((a, b) => b.score - a.score);
      const topK = scored.slice(0, 6);
      contextPieces = topK
        .filter((s) => s.score > 0)
        .map((s) => store.chunks[s.idx]);
    }

    // If no relevant chunks found, use first few chunks as fallback
    if (contextPieces.length === 0 && store.chunks.length > 0) {
      contextPieces = store.chunks.slice(0, 3);
    }

    const context = contextPieces.join("\n\n---\n\n");

    const systemPrompt = `
You are a **Socratic medical tutor** helping a learner choose medications for **Type 2 Diabetes Mellitus**.

CRITICAL RULES:
- You must **only** use information contained in the CONTEXT from the uploaded PDFs.
- If something is not supported or clearly stated in the CONTEXT, say you **cannot answer from the dataset** and invite the learner to look for it in their materials.
- You are not a clinician and are not giving real medical advice; this is an educational simulation only.

Socratic behavior:
- In **questions mode**, you respond **only with questions or brief prompts** that push the learner to:
  - Clarify the patient's comorbidities, lab values, and goals (e.g. ASCVD, CKD, obesity, hypoglycemia risk, cost).
  - Compare drug classes from the PDFs (e.g. metformin, SGLT2i, GLP-1 RA, insulin, sulfonylureas, TZDs, DPP-4i) strictly based on the dataset.
  - Justify why one option is preferred over alternatives given the case (again, only as reflected in the context).
- **Do not reveal the correct regimen or give direct recommendations** in questions mode.
- Ask 1–3 targeted, high-yield questions at a time; avoid long speeches.

Feedback behavior:
- In **feedback mode**, first briefly summarize the patient's case (from the conversation), then:
  - Summarize the learner's reasoning chain.
  - Identify strengths and correct applications of the dataset.
  - Point out specific gaps, contradictions, or missed PDF information.
  - Suggest what an evidence-aligned approach would look like, quoting or paraphrasing from the CONTEXT.
- If the CONTEXT is insufficient to fully answer, clearly say so and stop rather than guessing.

Always keep your language clear, concise, and at the level of a senior medical student.
`;

    const contextMessage = context
      ? `CONTEXT (from uploaded PDFs):\n\n${context}`
      : "No relevant context found in the uploaded PDFs for this query. You must say this explicitly to the learner.";

    const modeInstruction =
      mode === "feedback"
        ? "You are now in FEEDBACK MODE. The learner has finished their reasoning. Provide structured feedback as described, still grounded only in the CONTEXT."
        : "You are in QUESTIONS MODE. Do NOT give answers or recommendations; respond only with Socratic questions and prompts.";

    const chatMessages = [
      { role: "system", content: systemPrompt },
      { role: "system", content: contextMessage },
      { role: "system", content: modeInstruction },
      ...messages
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      temperature: 0.3
    });

    const reply = completion.choices[0].message;

    res.json({
      reply
    });
  } catch (err) {
    console.error("Error in /api/chat", err);
    res.status(500).json({ error: "Failed to generate Socratic tutor response" });
  }
});

/**
 * Generate a T2DM case based on uploaded PDFs
 * POST /api/generate-case
 * Headers: x-user-id
 */
app.post("/api/generate-case", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId) {
      return res.status(400).json({ error: "Missing x-user-id header" });
    }

    if (!openai) {
      return res.status(503).json({
        error: "AI is not configured. Set OPENAI_API_KEY on the server to generate cases."
      });
    }

    const store = userStores.get(userId);
    if (!store || !store.chunks || store.chunks.length === 0) {
      return res
        .status(400)
        .json({ error: "No PDF knowledge found. Please upload PDFs first." });
    }

    // Get a sample of chunks to understand what the PDFs contain
    const sampleChunks = store.chunks.slice(0, Math.min(10, store.chunks.length));
    const sampleText = sampleChunks.join("\n\n---\n\n");

    const caseGenerationPrompt = `
You are creating educational patient cases for medical students learning Type 2 Diabetes Mellitus medication selection.

Based on the following content from uploaded PDFs about T2DM medications, create a realistic patient case that will help students practice selecting appropriate medications.

CONTENT FROM PDFs:
${sampleText}

Create a patient case that:
1. Includes relevant demographics (age, gender if relevant)
2. Includes key lab values (HbA1c, eGFR, BMI, etc.)
3. Includes relevant comorbidities or risk factors (ASCVD, CKD, heart failure, obesity, etc.)
4. Presents a scenario where medication selection matters (e.g., new diagnosis, need to intensify, side effects, etc.)
5. Is based on the information available in the PDFs (don't make up details not supported by the content)

Format the case as a clear, concise patient presentation suitable for a medical student. Do not include the answer or recommended treatment - just present the case.

Example format:
"Patient: 65-year-old male with Type 2 Diabetes Mellitus diagnosed 3 years ago.
Current medications: Metformin 1000mg twice daily
HbA1c: 8.5% (target <7%)
eGFR: 45 mL/min/1.73m²
BMI: 32 kg/m²
History: Hypertension, stable coronary artery disease
No history of heart failure
Patient reports occasional gastrointestinal upset with metformin

What medication would you add or change?"

Generate a NEW case (different from the example) based on the PDF content.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert medical educator creating realistic patient cases for teaching Type 2 Diabetes Mellitus medication selection. Always base cases strictly on the provided PDF content."
        },
        { role: "user", content: caseGenerationPrompt }
      ],
      temperature: 0.7
    });

    const caseText = completion.choices[0].message.content;

    res.json({
      case: caseText
    });
  } catch (err) {
    console.error("Error in /api/generate-case", err);
    res.status(500).json({ error: "Failed to generate case" });
  }
});

/**
 * Generate an adaptive progressive case with difficulty based on user performance
 * POST /api/generate-adaptive-case
 * Body: { userId, difficultyLevel (optional, 1-5), performanceHistory (optional) }
 */
app.post("/api/generate-adaptive-case", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    const { difficultyLevel = 3, performanceHistory = [] } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: "Missing x-user-id header" });
    }

    if (!openai) {
      return res.status(503).json({
        error: "AI is not configured. Set OPENAI_API_KEY on the server to generate cases."
      });
    }

    const store = userStores.get(userId);
    if (!store || !store.chunks || store.chunks.length === 0) {
      return res
        .status(400)
        .json({ error: "No PDF knowledge found. Please upload PDFs first." });
    }

    // Calculate difficulty based on performance history
    let adaptiveDifficulty = difficultyLevel;
    if (performanceHistory.length > 0) {
      const recentPerformance = performanceHistory.slice(-5); // Last 5 cases
      const avgScore = recentPerformance.reduce((sum, p) => sum + (p.score || 0), 0) / recentPerformance.length;
      
      if (avgScore > 0.8) {
        adaptiveDifficulty = Math.min(5, difficultyLevel + 1); // Increase difficulty
      } else if (avgScore < 0.5) {
        adaptiveDifficulty = Math.max(1, difficultyLevel - 1); // Decrease difficulty
      }
    }

    // Get relevant chunks for case generation
    const sampleChunks = store.chunks.slice(0, Math.min(15, store.chunks.length));
    const sampleText = sampleChunks.join("\n\n---\n\n");

    const difficultyDescriptions = {
      1: "Beginner: Simple case with clear indications, minimal comorbidities, straightforward medication choice",
      2: "Easy: Basic case with one or two relevant factors to consider",
      3: "Intermediate: Moderate complexity with multiple factors, some trade-offs",
      4: "Advanced: Complex case with multiple comorbidities, conflicting priorities, nuanced decision-making",
      5: "Expert: Highly complex case requiring deep understanding, multiple considerations, and sophisticated reasoning"
    };

    const adaptiveCasePrompt = `
You are creating an adaptive, progressive case-based reasoning exercise for medical students learning Type 2 Diabetes Mellitus medication selection.

CONTENT FROM PDFs:
${sampleText}

Create a progressive disclosure case with ${adaptiveDifficulty} steps. Difficulty level: ${difficultyDescriptions[adaptiveDifficulty] || difficultyDescriptions[3]}

The case should be structured as a progressive vignette where:
1. Step 1: Initial presentation (demographics, chief complaint, basic history)
2. Step 2: Key lab values and initial assessment
3. Step 3: Comorbidities and risk factors revealed
4. Step 4: Patient preferences, cost considerations, or additional context
5. Step 5: Final decision point with all information

Each step should:
- Reveal new critical information
- Require the learner to commit to a decision before proceeding
- Build complexity progressively
- Be grounded in the PDF content provided

Return a JSON object with this structure:
{
  "difficultyLevel": ${adaptiveDifficulty},
  "steps": [
    {
      "stepNumber": 1,
      "title": "Initial Presentation",
      "content": "Patient information revealed at this step",
      "decisionPrompt": "What is your initial assessment?",
      "expectedConsiderations": ["key factors learner should think about"]
    },
    ...
  ],
  "correctApproach": "The evidence-based approach based on PDF content",
  "keyLearningPoints": ["main teaching points from this case"]
}

Generate a realistic, educational case based strictly on the PDF content.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert medical educator creating progressive disclosure cases for deliberate practice. Always return valid JSON. Base cases strictly on provided PDF content."
        },
        { role: "user", content: adaptiveCasePrompt }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const caseData = JSON.parse(completion.choices[0].message.content);

    res.json({
      case: caseData,
      difficultyLevel: adaptiveDifficulty
    });
  } catch (err) {
    console.error("Error in /api/generate-adaptive-case", err);
    res.status(500).json({ error: "Failed to generate adaptive case" });
  }
});

/**
 * Evaluate learner's decision at a step
 * POST /api/evaluate-decision
 * Body: { userId, stepNumber, decision, caseData, reasoning }
 */
app.post("/api/evaluate-decision", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    const { stepNumber, decision, caseData, reasoning } = req.body || {};

    if (!userId || !caseData) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!openai) {
      return res.status(503).json({ error: "AI not configured" });
    }

    const store = userStores.get(userId);
    if (!store || !store.chunks || store.chunks.length === 0) {
      return res.status(400).json({ error: "No PDF knowledge found" });
    }

    // Get relevant context from PDFs
    const queryText = `${decision} ${reasoning} ${caseData.steps?.[stepNumber - 1]?.content || ""}`;
    const queryEmbeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: queryText
    });
    const queryVector = queryEmbeddingResponse.data[0].embedding;

    const scored = store.vectors.map((vec, idx) => ({
      idx,
      score: cosineSimilarity(queryVector, vec)
    }));
    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, 5).filter((s) => s.score > 0);
    const contextPieces = topK.map((s) => store.chunks[s.idx]);
    const context = contextPieces.join("\n\n---\n\n");

    const evaluationPrompt = `
Evaluate the learner's decision and reasoning for a Type 2 Diabetes Mellitus medication selection case.

CURRENT STEP INFORMATION:
${JSON.stringify(caseData.steps?.[stepNumber - 1], null, 2)}

LEARNER'S DECISION: ${decision}
LEARNER'S REASONING: ${reasoning}

EVIDENCE FROM PDFs:
${context}

Evaluate:
1. Is the decision appropriate for the information revealed so far? (considering this is step ${stepNumber} of ${caseData.steps?.length})
2. Is the reasoning sound and evidence-based?
3. What key considerations did they identify or miss?
4. Provide constructive feedback without revealing future steps

Return JSON:
{
  "score": 0.0-1.0,
  "isAppropriate": true/false,
  "feedback": "constructive feedback",
  "strengths": ["what they did well"],
  "gaps": ["what they missed or could improve"],
  "canProceed": true/false
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a medical educator providing formative feedback. Be encouraging but honest. Return valid JSON only."
        },
        { role: "user", content: evaluationPrompt }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const evaluation = JSON.parse(completion.choices[0].message.content);

    res.json(evaluation);
  } catch (err) {
    console.error("Error in /api/evaluate-decision", err);
    res.status(500).json({ error: "Failed to evaluate decision" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

