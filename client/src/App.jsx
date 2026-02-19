import React, { useState } from "react";

const API_BASE = "http://localhost:4000/api";

function App() {
  // Anonymous session id (persists per browser) so backend can isolate uploads/chats
  const [sessionId] = useState(() => {
    if (typeof window === "undefined") return "anon";
    const existing = window.localStorage.getItem("t2dm_session_id");
    if (existing) return existing;
    const rand = `anon-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem("t2dm_session_id", rand);
    return rand;
  });
  const [uploadStatus, setUploadStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [generatedCase, setGeneratedCase] = useState(null);
  const [isGeneratingCase, setIsGeneratingCase] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("questions"); // "questions" | "feedback"
  const [isSending, setIsSending] = useState(false);

  const handleUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    Array.from(files).forEach((file) => {
      formData.append("files", file);
    });

    setIsUploading(true);
    setUploadStatus("Processing PDFs...");

    try {
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        headers: {
          "x-user-id": sessionId
        },
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }
      setUploadStatus(`Indexed ${data.chunkCount} text chunks from your PDFs.`);
      
      // Automatically generate a case after successful upload
      await generateCase();
    } catch (err) {
      console.error("Upload error", err);
      setUploadStatus("Failed to process PDFs.");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const generateCase = async () => {
    setIsGeneratingCase(true);
    try {
      const res = await fetch(`${API_BASE}/generate-case`, {
        method: "POST",
        headers: {
          "x-user-id": sessionId
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate case");
      }
      setGeneratedCase(data.case);
    } catch (err) {
      console.error("Case generation error", err);
      alert("Failed to generate case. You can still create your own case.");
    } finally {
      setIsGeneratingCase(false);
    }
  };

  const useGeneratedCase = () => {
    if (generatedCase) {
      setInput(generatedCase);
      setMessages([]); // Clear any existing messages
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const newMessages = [...messages, { role: "user", content: input.trim() }];
    setMessages(newMessages);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userId: sessionId,
          messages: newMessages,
          mode
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Chat request failed");
      }

      const reply = data.reply;
      setMessages((prev) => [...prev, reply]);
    } catch (err) {
      console.error("Chat error", err);
      alert("Failed to contact Socratic tutor.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h2>T2DM Socratic Tutor</h2>
          <p className="subtitle">
            Practice picking medications for Type 2 Diabetes Mellitus using your own guideline PDFs.
          </p>
        </div>
        <div className="user-info">
          <span className="user-name">
            Anonymous session
          </span>
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <h3>1. Upload your T2DM PDFs</h3>
          <p className="hint">
            Upload guidelines, lecture notes, or tables about Type 2 Diabetes medications. The AI will only use
            information from these files.
          </p>
          <input
            type="file"
            accept="application/pdf"
            multiple
            disabled={isUploading}
            onChange={handleUpload}
          />
          {uploadStatus && <p className="status">{uploadStatus}</p>}
        </section>

        <section className="panel">
          <h3>2. Case discussion (Socratic)</h3>
          
          {generatedCase && (
            <div className="generated-case-box">
              <h4>📋 Generated Case (based on your PDFs):</h4>
              <div className="case-content">{generatedCase}</div>
              <div className="case-actions">
                <button className="primary" onClick={useGeneratedCase}>
                  Use this case
                </button>
                <button className="secondary" onClick={generateCase} disabled={isGeneratingCase}>
                  {isGeneratingCase ? "Generating..." : "Generate new case"}
                </button>
              </div>
            </div>
          )}
          
          {!generatedCase && uploadStatus && (
            <div className="case-actions">
              <button className="primary" onClick={generateCase} disabled={isGeneratingCase}>
                {isGeneratingCase ? "Generating case..." : "Generate a case from your PDFs"}
              </button>
            </div>
          )}
          
          <p className="hint">
            {generatedCase 
              ? "Use the generated case above, or describe your own patient case and your initial medication choice."
              : "Start by describing a patient case and your initial medication choice (e.g. \"65-year-old with T2DM, eGFR 45, HbA1c 8.5%. I would start metformin.\")"}
          </p>

          <div className="mode-toggle">
            <span>Mode:</span>
            <button
              className={mode === "questions" ? "mode-btn active" : "mode-btn"}
              onClick={() => setMode("questions")}
            >
              Socratic questions
            </button>
            <button
              className={mode === "feedback" ? "mode-btn active" : "mode-btn"}
              onClick={() => setMode("feedback")}
            >
              Summarize feedback
            </button>
          </div>

          <div className="chat">
            <div className="chat-window">
              {messages.length === 0 && (
                <div className="empty-state">
                  No messages yet. Describe a patient and your chosen regimen to begin.
                </div>
              )}
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={
                    m.role === "user"
                      ? "chat-bubble user"
                      : "chat-bubble assistant"
                  }
                >
                  <div className="role-label">
                    {m.role === "user" ? "You" : "Tutor"}
                  </div>
                  <div>{m.content}</div>
                </div>
              ))}
            </div>

            <div className="chat-input">
              <textarea
                rows={3}
                placeholder={
                  mode === "questions"
                    ? "Type your case details and reasoning step (the tutor will respond with probing questions)..."
                    : "Explain that you are done reasoning and want feedback (e.g., “I'm done—please critique my plan.”)..."
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isSending}
              />
              <button
                className="primary"
                onClick={sendMessage}
                disabled={!input.trim() || isSending}
              >
                {isSending
                  ? "Thinking..."
                  : mode === "questions"
                  ? "Ask Socratic questions"
                  : "Request feedback"}
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>
          Educational use only. Do not use for real patient care decisions.
        </span>
      </footer>
    </div>
  );
}

export default App;

