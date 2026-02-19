import React, { useState, useEffect } from "react";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { auth, provider, db } from "./firebase";
import { collection, addDoc, query, where, getDocs, orderBy, doc, updateDoc, getDoc } from "firebase/firestore";
import ReactMarkdown from "react-markdown";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:4000/api" : "/api");

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
  
  const [user, setUser] = useState(null);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [generatedCase, setGeneratedCase] = useState(null);
  const [isGeneratingCase, setIsGeneratingCase] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("questions"); // "questions" | "feedback"
  const [mainMode, setMainMode] = useState("study"); // "study" | "training"
  const [trainingMode, setTrainingMode] = useState("socratic"); // "socratic" | "adaptive"
  const [studyPhase, setStudyPhase] = useState("deconstruction"); // "deconstruction" | "schema" | "contrast"
  const [isSending, setIsSending] = useState(false);
  
  // Study Mode state
  const [deconstructionItems, setDeconstructionItems] = useState([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [buckets, setBuckets] = useState({
    pathophysiology: [],
    redFlags: [],
    differentiators: [],
    goldStandard: []
  });
  const [draggedItem, setDraggedItem] = useState(null);
  const [schemaAnchor, setSchemaAnchor] = useState(null);
  const [schemaDrugs, setSchemaDrugs] = useState([]);
  const [comparisonDrugs, setComparisonDrugs] = useState([]);
  const [vennLabels, setVennLabels] = useState({ drug1Only: [], drug2Only: [], both: [], neither: [] });
  const [vennPlacements, setVennPlacements] = useState({ drug1Only: [], drug2Only: [], both: [], neither: [] });
  const [vennItemsPool, setVennItemsPool] = useState([]);
  const [isLoadingVenn, setIsLoadingVenn] = useState(false);
  const [savedSessions, setSavedSessions] = useState([]);
  const [currentLearningSessionId, setCurrentLearningSessionId] = useState(null);
  
  // Adaptive case-based reasoning state
  const [adaptiveCase, setAdaptiveCase] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepDecisions, setStepDecisions] = useState([]);
  const [stepEvaluations, setStepEvaluations] = useState([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [performanceHistory, setPerformanceHistory] = useState([]);
  const [difficultyLevel, setDifficultyLevel] = useState(3);
  const [decisionInput, setDecisionInput] = useState("");
  const [reasoningInput, setReasoningInput] = useState("");

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setCurrentSessionId(user ? user.uid : sessionId);
      if (user) {
        loadSavedSessions(user.uid);
      }
    });
    return () => unsubscribe();
  }, [sessionId]);

  // Get current user ID for API calls
  const getUserId = () => user?.uid || sessionId;

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login error", err);
      alert("Failed to sign in with Google.");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setMessages([]);
    setGeneratedCase(null);
    setCurrentLearningSessionId(null);
  };

  const loadSavedSessions = async (userId) => {
    try {
      const q = query(
        collection(db, "learningSessions"),
        where("userId", "==", userId),
        orderBy("createdAt", "desc")
      );
      const querySnapshot = await getDocs(q);
      const sessions = [];
      querySnapshot.forEach((doc) => {
        sessions.push({ id: doc.id, ...doc.data() });
      });
      setSavedSessions(sessions);
    } catch (err) {
      console.error("Error loading sessions", err);
    }
  };

  const saveLearningSession = async (newMessages) => {
    if (!user) return null; // Only save for logged-in users
    
    try {
      const now = new Date();
      const sessionData = {
        userId: user.uid,
        messages: newMessages,
        generatedCase: generatedCase || null,
        mode: mode,
        createdAt: now,
        updatedAt: now
      };

      if (currentLearningSessionId) {
        // Update existing session
        await updateDoc(doc(db, "learningSessions", currentLearningSessionId), {
          messages: newMessages,
          updatedAt: now
        });
        return currentLearningSessionId;
      } else {
        // Create new session
        const docRef = await addDoc(collection(db, "learningSessions"), sessionData);
        setCurrentLearningSessionId(docRef.id);
        await loadSavedSessions(user.uid);
        return docRef.id;
      }
    } catch (err) {
      console.error("Error saving session", err);
      return null;
    }
  };

  const loadSession = async (sessionId) => {
    try {
      const sessionDoc = await getDoc(doc(db, "learningSessions", sessionId));
      if (sessionDoc.exists()) {
        const sessionData = sessionDoc.data();
        setMessages(sessionData.messages || []);
        setGeneratedCase(sessionData.generatedCase || null);
        setMode(sessionData.mode || "questions");
        setCurrentLearningSessionId(sessionId);
      }
    } catch (err) {
      console.error("Error loading session", err);
    }
  };

  const startNewSession = () => {
    setMessages([]);
    setGeneratedCase(null);
    setAdaptiveCase(null);
    setCurrentStep(0);
    setStepDecisions([]);
    setStepEvaluations([]);
    setCurrentLearningSessionId(null);
  };

  // Load performance history from Firestore
  useEffect(() => {
    if (user) {
      loadPerformanceHistory();
    }
  }, [user]);

  const loadDeconstructionItems = async () => {
    setIsLoadingItems(true);
    try {
      const res = await fetch(`${API_BASE}/get-deconstruction-items`, {
        method: "GET",
        headers: {
          "x-user-id": getUserId()
        }
      });
      const data = await res.json();
      if (res.ok && data.items) {
        setDeconstructionItems(data.items);
      }
    } catch (err) {
      console.error("Error loading deconstruction items", err);
      alert("Failed to load items. Please try again.");
    } finally {
      setIsLoadingItems(false);
    }
  };

  const handleDragStart = (e, item) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e, bucketName) => {
    e.preventDefault();
    if (draggedItem) {
      // Remove from items list
      setDeconstructionItems(prev => prev.filter(item => item.id !== draggedItem.id));
      // Add to bucket
      setBuckets(prev => ({
        ...prev,
        [bucketName]: [...prev[bucketName], { ...draggedItem, id: Date.now() }]
      }));
      setDraggedItem(null);
    }
  };

  const removeFromBucket = (bucketName, id) => {
    const item = buckets[bucketName].find(i => i.id === id);
    if (item) {
      // Return to items list
      setDeconstructionItems(prev => [...prev, { id: item.id, text: item.text, drug: item.drug, suggestedCategory: item.suggestedCategory }]);
      // Remove from bucket
      setBuckets(prev => ({
        ...prev,
        [bucketName]: prev[bucketName].filter(i => i.id !== id)
      }));
    }
  };

  const loadPerformanceHistory = async () => {
    try {
      const q = query(
        collection(db, "learningSessions"),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );
      const querySnapshot = await getDocs(q);
      const history = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.performanceScore !== undefined && data.type === "adaptive") {
          history.push({
            score: data.performanceScore,
            difficulty: data.difficultyLevel || 3,
            date: data.createdAt
          });
        }
      });
      setPerformanceHistory(history);
      
      // Calculate average performance for difficulty adjustment
      if (history.length > 0) {
        const recentScores = history.slice(0, 5).map(h => h.score);
        const avgScore = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        if (avgScore > 0.8 && difficultyLevel < 5) {
          setDifficultyLevel(Math.min(5, difficultyLevel + 1));
        } else if (avgScore < 0.5 && difficultyLevel > 1) {
          setDifficultyLevel(Math.max(1, difficultyLevel - 1));
        }
      }
    } catch (err) {
      console.error("Error loading performance history", err);
    }
  };

  const generateAdaptiveCase = async () => {
    setIsGeneratingCase(true);
    try {
      const res = await fetch(`${API_BASE}/generate-adaptive-case`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": getUserId()
        },
        body: JSON.stringify({
          difficultyLevel,
          performanceHistory: performanceHistory.slice(-10) // Last 10 sessions
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate adaptive case");
      }
      setAdaptiveCase(data.case);
      setCurrentStep(0);
      setStepDecisions([]);
      setStepEvaluations([]);
      setDecisionInput("");
      setReasoningInput("");
      setDifficultyLevel(data.difficultyLevel);
    } catch (err) {
      console.error("Adaptive case generation error", err);
      alert("Failed to generate adaptive case.");
    } finally {
      setIsGeneratingCase(false);
    }
  };

  const commitDecision = async (decision, reasoning) => {
    if (!decision.trim() || !reasoning.trim()) {
      alert("Please provide both a decision and your reasoning.");
      return;
    }

    setIsEvaluating(true);
    const stepIndex = currentStep;
    const stepDecision = { stepNumber: stepIndex + 1, decision, reasoning };

    try {
      const res = await fetch(`${API_BASE}/evaluate-decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": getUserId()
        },
        body: JSON.stringify({
          stepNumber: stepIndex + 1,
          decision,
          reasoning,
          caseData: adaptiveCase
        })
      });
      const evaluation = await res.json();
      if (!res.ok) {
        throw new Error(evaluation.error || "Failed to evaluate decision");
      }

      setStepDecisions([...stepDecisions, stepDecision]);
      setStepEvaluations([...stepEvaluations, evaluation]);

      // If can proceed, move to next step
      if (evaluation.canProceed && currentStep < adaptiveCase.steps.length - 1) {
        setCurrentStep(currentStep + 1);
      }
    } catch (err) {
      console.error("Evaluation error", err);
      alert("Failed to evaluate decision.");
    } finally {
      setIsEvaluating(false);
    }
  };

  const completeAdaptiveCase = async () => {
    // Calculate final score
    const avgScore = stepEvaluations.reduce((sum, e) => sum + (e.score || 0), 0) / stepEvaluations.length;
    
    // Save to Firestore
    if (user) {
      try {
        const sessionData = {
          userId: user.uid,
          type: "adaptive",
          adaptiveCase,
          stepDecisions,
          stepEvaluations,
          performanceScore: avgScore,
          difficultyLevel,
          completedAt: new Date(),
          createdAt: new Date()
        };
        await addDoc(collection(db, "learningSessions"), sessionData);
        await loadPerformanceHistory();
      } catch (err) {
        console.error("Error saving adaptive session", err);
      }
    }

    // Show final feedback
    alert(`Case completed! Average score: ${(avgScore * 100).toFixed(1)}%\n\nKey Learning Points:\n${adaptiveCase.keyLearningPoints?.join('\n') || 'Review your decisions and the correct approach.'}`);
  };

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
          "x-user-id": getUserId()
        },
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }
      setUploadStatus(`Indexed ${data.chunkCount} text chunks from your PDFs.`);
      
      // Automatically generate a case after successful upload (only in training mode)
      if (mainMode === "training") {
        await generateCase();
      }
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
          "x-user-id": getUserId()
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate case");
      }
      setGeneratedCase(data.case);
      // Update session if exists
      if (currentLearningSessionId && user) {
        await updateDoc(doc(db, "learningSessions", currentLearningSessionId), {
          generatedCase: data.case,
          updatedAt: new Date()
        });
      }
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
          userId: getUserId(),
          messages: newMessages,
          mode
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Chat request failed");
      }

      const reply = data.reply;
      const updatedMessages = [...newMessages, reply];
      setMessages(updatedMessages);
      
      // Save to Firestore if user is logged in
      await saveLearningSession(updatedMessages);
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
          <h2>Medical Learning Coach</h2>
          <p className="subtitle">
            Practice picking medications and learning using your own guideline PDFs.
          </p>
        </div>
        <div className="user-info">
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span className="user-name">{user.displayName}</span>
              <button className="secondary" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          ) : (
            <button className="primary" onClick={handleLogin}>
              Sign in with Google
            </button>
          )}
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <h3>1. Upload your PDFs</h3>
          <p className="hint">
            Upload guidelines, papers, lecture notes, or tables about your subject (pdf only). The AI will only use
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
          <h3>2. Mode Selection</h3>
          
          <div className="main-mode-toggle">
            <span>Select mode:</span>
            <button
              className={mainMode === "study" ? "mode-btn active" : "mode-btn"}
              onClick={() => {
                setMainMode("study");
                setMessages([]);
                setGeneratedCase(null);
                setAdaptiveCase(null);
              }}
            >
              Study Mode
            </button>
            <button
              className={mainMode === "training" ? "mode-btn active" : "mode-btn"}
              onClick={() => {
                setMainMode("training");
                setStudyPhase("deconstruction");
                setBuckets({
                  pathophysiology: [],
                  redFlags: [],
                  differentiators: [],
                  goldStandard: []
                });
              }}
            >
              Training Mode
            </button>
          </div>

          {mainMode === "study" && (
            <div className="study-mode-container">
              <div className="study-phase-selector">
                <button
                  className={studyPhase === "deconstruction" ? "phase-btn active" : "phase-btn"}
                  onClick={() => setStudyPhase("deconstruction")}
                >
                  Phase 1: Deconstruction
                </button>
                <button
                  className={studyPhase === "schema" ? "phase-btn active" : "phase-btn"}
                  onClick={() => setStudyPhase("schema")}
                >
                  Phase 2: Schema Mapping
                </button>
                <button
                  className={studyPhase === "contrast" ? "phase-btn active" : "phase-btn"}
                  onClick={() => setStudyPhase("contrast")}
                >
                  Phase 3: Contrast & Compare
                </button>
              </div>

              {studyPhase === "deconstruction" && (
                <div className="deconstruction-phase">
                  <h4>Deconstruction Phase: Segment Your Dataset</h4>
                  <p className="hint">
                    Drag items from the dataset into the correct bucket. This helps you organize information by function.
                  </p>
                  
                  {deconstructionItems.length === 0 && !isLoadingItems && (
                    <button className="primary" onClick={loadDeconstructionItems} style={{ marginBottom: "1rem" }}>
                      Load Items from Dataset
                    </button>
                  )}
                  
                  {isLoadingItems && <p>Analyzing dataset and extracting items...</p>}
                  
                  {deconstructionItems.length > 0 && (
                    <div className="deconstruction-workspace">
                      <div className="items-panel">
                        <h5>Extracted Items ({deconstructionItems.length})</h5>
                        <div className="items-list">
                          {deconstructionItems.map((item) => (
                            <div
                              key={item.id}
                              className="draggable-item"
                              draggable
                              onDragStart={(e) => handleDragStart(e, item)}
                              title={`Drug: ${item.drug || 'General'}`}
                            >
                              {item.text}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="buckets-panel">
                        <h5>Organize Into Buckets</h5>
                        <div className="buckets-grid">
                          <div 
                            className="bucket" 
                            onDrop={(e) => handleDrop(e, "pathophysiology")} 
                            onDragOver={handleDragOver}
                          >
                            <h6>Pathophysiology</h6>
                            {buckets.pathophysiology.map((item) => (
                              <div key={item.id} className="bucket-item">
                                <span>{item.text}</span>
                                <button onClick={() => removeFromBucket("pathophysiology", item.id)}>×</button>
                              </div>
                            ))}
                          </div>

                          <div 
                            className="bucket" 
                            onDrop={(e) => handleDrop(e, "redFlags")} 
                            onDragOver={handleDragOver}
                          >
                            <h6>Red Flags / Contraindications</h6>
                            {buckets.redFlags.map((item) => (
                              <div key={item.id} className="bucket-item">
                                <span>{item.text}</span>
                                <button onClick={() => removeFromBucket("redFlags", item.id)}>×</button>
                              </div>
                            ))}
                          </div>

                          <div 
                            className="bucket" 
                            onDrop={(e) => handleDrop(e, "differentiators")} 
                            onDragOver={handleDragOver}
                          >
                            <h6>Differentiators</h6>
                            {buckets.differentiators.map((item) => (
                              <div key={item.id} className="bucket-item">
                                <span>{item.text}</span>
                                <button onClick={() => removeFromBucket("differentiators", item.id)}>×</button>
                              </div>
                            ))}
                          </div>

                          <div 
                            className="bucket" 
                            onDrop={(e) => handleDrop(e, "goldStandard")} 
                            onDragOver={handleDragOver}
                          >
                            <h6>Gold Standard / Best Practices</h6>
                            {buckets.goldStandard.map((item) => (
                              <div key={item.id} className="bucket-item">
                                <span>{item.text}</span>
                                <button onClick={() => removeFromBucket("goldStandard", item.id)}>×</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {studyPhase === "schema" && (
                <div className="schema-phase">
                  <h4>Schema Mapping Phase: Build Illness Scripts</h4>
                  <p className="hint">
                    Select a patient anchor and build their illness script by choosing which drugs belong in that script.
                  </p>
                  
                  <div className="schema-workspace">
                    <div className="anchor-selector">
                      <h5>Select Patient Anchor</h5>
                      <div className="anchor-buttons">
                        {["Heart Failure Patient", "CKD Patient", "ASCVD Patient", "Obesity Patient", "Newly Diagnosed"].map(anchor => (
                          <button
                            key={anchor}
                            className={schemaAnchor === anchor ? "anchor-btn active" : "anchor-btn"}
                            onClick={() => setSchemaAnchor(anchor)}
                          >
                            {anchor}
                          </button>
                        ))}
                      </div>
                    </div>

                    {schemaAnchor && (
                      <div className="script-builder">
                        <h5>Build Script for: {schemaAnchor}</h5>
                        <p className="hint">Select drugs that belong in this patient's script. The system will check your choices against the dataset.</p>
                        <div className="drug-selector">
                          {["Metformin", "SGLT2i", "GLP-1 RA", "DPP-4i", "Sulfonylureas", "TZDs", "Insulin"].map(drug => (
                            <label key={drug} className="drug-checkbox">
                              <input
                                type="checkbox"
                                checked={schemaDrugs.includes(drug)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSchemaDrugs([...schemaDrugs, drug]);
                                  } else {
                                    setSchemaDrugs(schemaDrugs.filter(d => d !== drug));
                                  }
                                }}
                              />
                              {drug}
                            </label>
                          ))}
                        </div>
                        <button 
                          className="primary"
                          onClick={async () => {
                            // Check against dataset
                            const res = await fetch(`${API_BASE}/check-schema`, {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                                "x-user-id": getUserId()
                              },
                              body: JSON.stringify({
                                anchor: schemaAnchor,
                                selectedDrugs: schemaDrugs
                              })
                            });
                            const feedback = await res.json();
                            if (res.ok) {
                              alert(feedback.feedback || "Check completed. Review your selections.");
                            }
                          }}
                          disabled={schemaDrugs.length === 0}
                        >
                          Check Script
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {studyPhase === "contrast" && (
                <div className="contrast-phase">
                  <h4>Contrast & Compare Phase: Find Discriminators</h4>
                  <p className="hint">
                    Compare two drug classes using a Venn diagram. Drag labels into the correct sections to identify unique and shared features.
                  </p>
                  
                  <div className="contrast-workspace">
                    <div className="drug-comparison-selector">
                      <h5>Select Two Drug Classes to Compare</h5>
                      <div className="comparison-selector">
                        <select 
                          value={comparisonDrugs[0] || ""} 
                          onChange={(e) => {
                            setComparisonDrugs([e.target.value, comparisonDrugs[1] || ""]);
                            setVennLabels({ drug1Only: [], drug2Only: [], both: [], neither: [] });
                            setVennPlacements({ drug1Only: [], drug2Only: [], both: [], neither: [] });
                            setVennItemsPool([]);
                          }}
                        >
                          <option value="">Select first drug...</option>
                          <option value="SGLT2i">SGLT2i</option>
                          <option value="GLP-1 RA">GLP-1 RA</option>
                          <option value="Metformin">Metformin</option>
                          <option value="DPP-4i">DPP-4i</option>
                          <option value="Sulfonylureas">Sulfonylureas</option>
                          <option value="TZDs">TZDs</option>
                        </select>
                        <span>vs</span>
                        <select 
                          value={comparisonDrugs[1] || ""} 
                          onChange={(e) => {
                            setComparisonDrugs([comparisonDrugs[0] || "", e.target.value]);
                            setVennLabels({ drug1Only: [], drug2Only: [], both: [], neither: [] });
                            setVennPlacements({ drug1Only: [], drug2Only: [], both: [], neither: [] });
                            setVennItemsPool([]);
                          }}
                        >
                          <option value="">Select second drug...</option>
                          <option value="SGLT2i">SGLT2i</option>
                          <option value="GLP-1 RA">GLP-1 RA</option>
                          <option value="Metformin">Metformin</option>
                          <option value="DPP-4i">DPP-4i</option>
                          <option value="Sulfonylureas">Sulfonylureas</option>
                          <option value="TZDs">TZDs</option>
                        </select>
                      </div>
                    </div>

                    {comparisonDrugs[0] && comparisonDrugs[1] && (
                      <div className="venn-interface">
                        {vennLabels.drug1Only.length === 0 && !isLoadingVenn && (
                          <button 
                            className="primary"
                            onClick={async () => {
                              setIsLoadingVenn(true);
                              try {
                                const res = await fetch(`${API_BASE}/generate-venn-labels`, {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                    "x-user-id": getUserId()
                                  },
                                  body: JSON.stringify({
                                    drug1: comparisonDrugs[0],
                                    drug2: comparisonDrugs[1]
                                  })
                                });
                                const data = await res.json();
                                if (res.ok) {
                                  setVennLabels(data);
                                  // Combine all labels for dragging
                                  const allLabels = [
                                    ...(data.drug1Only || []),
                                    ...(data.drug2Only || []),
                                    ...(data.both || []),
                                    ...(data.neither || [])
                                  ];
                                  setVennItemsPool(allLabels);
                                }
                              } catch (err) {
                                console.error("Error loading Venn labels", err);
                                alert("Failed to generate labels");
                              } finally {
                                setIsLoadingVenn(false);
                              }
                            }}
                          >
                            Generate Comparison Labels
                          </button>
                        )}
                        
                        {isLoadingVenn && <p>Generating comparison labels...</p>}

                        {vennLabels.drug1Only.length > 0 && (
                          <div className="venn-diagram-container">
                            <div className="venn-diagram">
                              <div 
                                className="venn-section drug1-only"
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (draggedItem) {
                                    setVennPlacements(prev => ({
                                      ...prev,
                                      drug1Only: [...prev.drug1Only, draggedItem]
                                    }));
                                    setVennItemsPool(prev => prev.filter(item => item.id !== draggedItem.id));
                                    setDraggedItem(null);
                                  }
                                }}
                                onDragOver={handleDragOver}
                              >
                                <h6>{comparisonDrugs[0]} Only</h6>
                                {vennPlacements.drug1Only.map((item) => (
                                  <div key={item.id} className="venn-label">
                                    {item.text}
                                    <button onClick={() => {
                                      setVennPlacements(prev => ({
                                        ...prev,
                                        drug1Only: prev.drug1Only.filter(i => i.id !== item.id)
                                      }));
                                      setVennItemsPool(prev => [...prev, item]);
                                    }}>×</button>
                                  </div>
                                ))}
                              </div>

                              <div 
                                className="venn-section both"
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (draggedItem) {
                                    setVennPlacements(prev => ({
                                      ...prev,
                                      both: [...prev.both, draggedItem]
                                    }));
                                    setDeconstructionItems(prev => prev.filter(item => item.id !== draggedItem.id));
                                    setDraggedItem(null);
                                  }
                                }}
                                onDragOver={handleDragOver}
                              >
                                <h6>Both</h6>
                                {vennPlacements.both.map((item) => (
                                  <div key={item.id} className="venn-label">
                                    {item.text}
                                    <button onClick={() => {
                                      setVennPlacements(prev => ({
                                        ...prev,
                                        both: prev.both.filter(i => i.id !== item.id)
                                      }));
                                      setVennItemsPool(prev => [...prev, item]);
                                    }}>×</button>
                                  </div>
                                ))}
                              </div>

                              <div 
                                className="venn-section drug2-only"
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (draggedItem) {
                                    setVennPlacements(prev => ({
                                      ...prev,
                                      drug2Only: [...prev.drug2Only, draggedItem]
                                    }));
                                    setDeconstructionItems(prev => prev.filter(item => item.id !== draggedItem.id));
                                    setDraggedItem(null);
                                  }
                                }}
                                onDragOver={handleDragOver}
                              >
                                <h6>{comparisonDrugs[1]} Only</h6>
                                {vennPlacements.drug2Only.map((item) => (
                                  <div key={item.id} className="venn-label">
                                    {item.text}
                                    <button onClick={() => {
                                      setVennPlacements(prev => ({
                                        ...prev,
                                        drug2Only: prev.drug2Only.filter(i => i.id !== item.id)
                                      }));
                                      setVennItemsPool(prev => [...prev, item]);
                                    }}>×</button>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="labels-pool">
                              <h5>Labels to Place ({vennItemsPool.length})</h5>
                              <div className="labels-list">
                                {vennItemsPool.map((item) => (
                                  <div
                                    key={item.id}
                                    className="draggable-item"
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, item)}
                                  >
                                    {item.text}
                                  </div>
                                ))}
                              </div>
                            </div>

                            <button 
                              className="primary"
                              onClick={async () => {
                                // Check placements
                                const res = await fetch(`${API_BASE}/check-venn`, {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                    "x-user-id": getUserId()
                                  },
                                  body: JSON.stringify({
                                    drug1: comparisonDrugs[0],
                                    drug2: comparisonDrugs[1],
                                    placements: vennPlacements,
                                    correctLabels: vennLabels
                                  })
                                });
                                const feedback = await res.json();
                                if (res.ok) {
                                  alert(feedback.feedback || "Placement checked!");
                                }
                              }}
                              disabled={vennItemsPool.length > 0}
                            >
                              Check Placement
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {mainMode === "training" && (
            <>
              <div className="training-mode-toggle">
                <span>Select training method:</span>
                <button
                  className={trainingMode === "socratic" ? "mode-btn active" : "mode-btn"}
                  onClick={() => {
                    setTrainingMode("socratic");
                    setAdaptiveCase(null);
                    setCurrentStep(0);
                    setStepDecisions([]);
                    setStepEvaluations([]);
                    setDecisionInput("");
                    setReasoningInput("");
                  }}
                >
                  Socratic Tutor
                </button>
                <button
                  className={trainingMode === "adaptive" ? "mode-btn active" : "mode-btn"}
                  onClick={() => {
                    setTrainingMode("adaptive");
                    setMessages([]);
                    setGeneratedCase(null);
                    setDecisionInput("");
                    setReasoningInput("");
                  }}
                >
                  Adaptive Case-Based
                </button>
              </div>

              {trainingMode === "adaptive" && (
            <div className="adaptive-info">
              <p className="hint">
                <strong>Adaptive Case-Based Reasoning:</strong> Progressive disclosure with step-by-step decisions.
                Commit to your decision at each step before proceeding. Difficulty adapts based on your performance.
              </p>
              {performanceHistory.length > 0 && (
                <div className="performance-stats">
                  <span>Avg Score: {(performanceHistory.slice(-5).reduce((sum, h) => sum + h.score, 0) / Math.min(5, performanceHistory.length) * 100).toFixed(1)}%</span>
                  <span>Difficulty: {difficultyLevel}/5</span>
                </div>
              )}
            </div>
          )}

              {trainingMode === "socratic" && (
                <>
                  {user && savedSessions.length > 0 && (
                    <div className="saved-sessions-box">
              <h4>📚 Saved Learning Sessions:</h4>
              <div className="sessions-list">
                {savedSessions.map((session) => (
                  <div key={session.id} className="session-item">
                    <div className="session-info">
                      <span className="session-date">
                        {session.createdAt?.toDate 
                          ? session.createdAt.toDate().toLocaleString()
                          : new Date(session.createdAt).toLocaleString()}
                      </span>
                      <span className="session-messages">{session.messages?.length || 0} messages</span>
                    </div>
                    <button className="secondary small" onClick={() => loadSession(session.id)}>
                      Load
                    </button>
                  </div>
                ))}
              </div>
                    <button className="secondary" onClick={startNewSession} style={{ marginTop: "0.5rem" }}>
                      Start New Session
                    </button>
                  </div>
                  )}

              {generatedCase && (
                <div className="generated-case-box">
                  <h4>📋 Generated Case (based on your PDFs):</h4>
                  <div className="case-content">
                    <ReactMarkdown>{generatedCase}</ReactMarkdown>
                  </div>
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
                      onClick={async () => {
                        setMode("feedback");
                        // Auto-generate feedback when switching to feedback mode
                        if (messages.length > 0) {
                          setIsSending(true);
                          try {
                            const res = await fetch(`${API_BASE}/chat`, {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json"
                              },
                              body: JSON.stringify({
                                userId: getUserId(),
                                messages: [...messages, { role: "user", content: "I'm done reasoning. Please provide comprehensive feedback on my approach." }],
                                mode: "feedback"
                              })
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              throw new Error(data.error || "Chat request failed");
                            }

                            const reply = data.reply;
                            const updatedMessages = [...messages, { role: "user", content: "I'm done reasoning. Please provide comprehensive feedback on my approach." }, reply];
                            setMessages(updatedMessages);
                            
                            // Save to Firestore if user is logged in
                            await saveLearningSession(updatedMessages);
                          } catch (err) {
                            console.error("Chat error", err);
                            alert("Failed to generate feedback.");
                          } finally {
                            setIsSending(false);
                          }
                        }
                      }}
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
                          <div>
                            {m.role === "assistant" ? (
                              <ReactMarkdown>{m.content}</ReactMarkdown>
                            ) : (
                              m.content
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="chat-input">
                      <textarea
                        rows={3}
                        placeholder={
                          mode === "questions"
                            ? "Type your case details and reasoning step (the tutor will respond with probing questions)..."
                            : "Explain that you are done reasoning and want feedback (e.g., \"I'm done—please critique my plan.\")..."
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
                </>
              )}

              {trainingMode === "adaptive" && (
            <div className="adaptive-case-container">
              {!adaptiveCase ? (
                <div className="case-actions">
                  <button className="primary" onClick={generateAdaptiveCase} disabled={isGeneratingCase || !uploadStatus}>
                    {isGeneratingCase ? "Generating adaptive case..." : "Start Adaptive Case"}
                  </button>
                  {!uploadStatus && (
                    <p className="hint" style={{ marginTop: "0.5rem" }}>
                      Please upload PDFs first to generate adaptive cases.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="adaptive-case-progress">
                    <h4>Step {currentStep + 1} of {adaptiveCase.steps.length}</h4>
                    <div className="progress-bar">
                      {adaptiveCase.steps.map((_, idx) => (
                        <div
                          key={idx}
                          className={`progress-step ${idx <= currentStep ? "completed" : ""} ${idx === currentStep ? "active" : ""}`}
                        />
                      ))}
                    </div>
                  </div>

                  {adaptiveCase.steps.map((step, idx) => {
                    if (idx > currentStep) return null;
                    
                    const evaluation = stepEvaluations[idx];
                    const decision = stepDecisions[idx];

                    return (
                      <div key={idx} className={`adaptive-step ${idx === currentStep ? "current" : "completed"}`}>
                        <h4>{step.title}</h4>
                        <div className="step-content">
                          <ReactMarkdown>{step.content}</ReactMarkdown>
                        </div>

                        {decision && evaluation && (
                          <div className="decision-feedback">
                            <div className="decision-commitment">
                              <strong>Your Decision:</strong> {decision.decision}
                              <br />
                              <strong>Your Reasoning:</strong> {decision.reasoning}
                            </div>
                            <div className={`evaluation ${evaluation.score > 0.7 ? "good" : evaluation.score > 0.4 ? "moderate" : "needs-work"}`}>
                              <div className="evaluation-score">Score: {(evaluation.score * 100).toFixed(0)}%</div>
                              <ReactMarkdown>{evaluation.feedback}</ReactMarkdown>
                              {evaluation.strengths && evaluation.strengths.length > 0 && (
                                <div className="strengths">
                                  <strong>Strengths:</strong>
                                  <ul>
                                    {evaluation.strengths.map((s, i) => <li key={i}>{s}</li>)}
                                  </ul>
                                </div>
                              )}
                              {evaluation.gaps && evaluation.gaps.length > 0 && (
                                <div className="gaps">
                                  <strong>Areas to improve:</strong>
                                  <ul>
                                    {evaluation.gaps.map((g, i) => <li key={i}>{g}</li>)}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {idx === currentStep && !decision && (
                          <div className="decision-form">
                            <h5>{step.decisionPrompt}</h5>
                            <input
                              type="text"
                              placeholder="Your decision (e.g., 'I would start metformin')"
                              value={decisionInput}
                              onChange={(e) => setDecisionInput(e.target.value)}
                              disabled={isEvaluating}
                              style={{ width: "100%", padding: "0.5rem", marginBottom: "0.5rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                            />
                            <textarea
                              rows={3}
                              placeholder="Your reasoning (explain why you made this decision)"
                              value={reasoningInput}
                              onChange={(e) => setReasoningInput(e.target.value)}
                              disabled={isEvaluating}
                              style={{ width: "100%", padding: "0.5rem", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}
                            />
                            <button
                              className="primary"
                              onClick={() => {
                                commitDecision(decisionInput, reasoningInput);
                                setDecisionInput("");
                                setReasoningInput("");
                              }}
                              disabled={isEvaluating || !decisionInput.trim() || !reasoningInput.trim()}
                              style={{ marginTop: "0.5rem" }}
                            >
                              {isEvaluating ? "Evaluating..." : "Commit Decision"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {currentStep === adaptiveCase.steps.length - 1 && stepDecisions.length === adaptiveCase.steps.length && (
                    <div className="case-complete">
                      <h4>Case Complete!</h4>
                      <ReactMarkdown>{adaptiveCase.correctApproach}</ReactMarkdown>
                      <div className="learning-points">
                        <h5>Key Learning Points:</h5>
                        <ul>
                          {adaptiveCase.keyLearningPoints?.map((point, i) => (
                            <li key={i}>{point}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="case-actions">
                        <button className="primary" onClick={completeAdaptiveCase}>
                          Save & Complete
                        </button>
                        <button className="secondary" onClick={() => {
                          setAdaptiveCase(null);
                          setCurrentStep(0);
                          setStepDecisions([]);
                          setStepEvaluations([]);
                          setDecisionInput("");
                          setReasoningInput("");
                        }}>
                          Start New Case
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
              )}
            </>
          )}
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

