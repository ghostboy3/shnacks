## T2DM Socratic Tutor Prototype

This prototype teaches medical students how to select medications for patients with Type 2 Diabetes Mellitus using **Socratic questioning** over a **user-uploaded PDF dataset** (guidelines, notes, tables, etc.).

### High-level features

- **Google login via Firebase**
- **PDF upload** of T2DM medication resources
- **Server-side PDF text extraction + embeddings (OpenAI)**
- **Retrieval-augmented generation (RAG)** that is **strictly limited to the uploaded PDFs**
- **Socratic AI agent**:
  - Asks probing questions instead of giving answers
  - Pushes learners to articulate their full reasoning chain
  - Only provides feedback once the learner indicates they are done reasoning

### Tech stack

- **Frontend**: React + Vite + Firebase Web SDK
- **Backend**: Node.js + Express
- **AI**: OpenAI API (chat + embeddings)
- **Auth**: Firebase Authentication (Google provider)

### Quick start

1. **Install dependencies**

```bash
cd /home/nico-to/Coding/SHNacks2
cd server && npm install
cd ../client && npm install
```

2. **Configure environment variables**

Create a `.env` file inside `server`:

```bash
OPENAI_API_KEY=your_openai_key_here
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
```

> Use the OpenAI project key you provided; keep it **only** in this `.env` file (never commit it).

3. **Run backend**

```bash
cd /home/nico-to/Coding/SHNacks2/server
npm run dev
```

4. **Run frontend**

```bash
cd /home/nico-to/Coding/SHNacks2/client
npm run dev
```

Open the printed `localhost` URL (default `http://localhost:5173`).

### Flow

1. **Login with Google** (Firebase Auth).
2. **Upload one or more PDF files** with T2DM medication information.
3. Start a **learning session**:
   - Enter a **patient case** and your **initial medication choice**.
   - The AI tutor:
     - Uses only your uploaded PDFs as knowledge.
     - Asks **Socratic questions** (e.g., about eGFR, ASCVD, weight, hypoglycemia risk).
     - Identifies **gaps or inconsistencies** in your reasoning.
   - When you’re done, tell the agent (e.g., “I’m done, please give feedback”) and it will provide a **structured critique** and suggestions, still grounded in the PDF dataset.

### Important constraints

- The AI is **explicitly instructed** to:
  - Only use information retrieved from the uploaded PDFs.
  - Refuse to fabricate drug details that are not present in the dataset.
  - Stay in **question-only mode** until the learner indicates they are finished reasoning.

