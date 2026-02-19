# Medical Learning Coach

A comprehensive learning platform for medical students to practice medication selection using their own PDF resources.

## Features

- **Study Mode**: Three-phase learning approach
  - Deconstruction: Segment dataset into functional categories
  - Schema Mapping: Build illness scripts for patient anchors
  - Contrast & Compare: Venn diagram comparison of drug classes

- **Training Mode**: 
  - Socratic Tutor: Interactive questioning to guide learning
  - Adaptive Case-Based: Progressive disclosure with difficulty adaptation

## Deployment to Vercel

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   vercel
   ```

4. **Set Environment Variables** in Vercel Dashboard:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `CLIENT_ORIGIN`: Your Vercel deployment URL (optional, defaults to *)

5. **For Production Deployment**:
   ```bash
   vercel --prod
   ```

## Environment Variables

- `OPENAI_API_KEY`: Required for AI features
- `CLIENT_ORIGIN`: CORS origin (optional, defaults to *)

## Local Development

1. **Backend**:
   ```bash
   cd server
   npm install
   npm run dev
   ```

2. **Frontend**:
   ```bash
   cd client
   npm install
   npm run dev
   ```

3. **Set up `.env` in server directory**:
   ```
   OPENAI_API_KEY=your_key_here
   PORT=4000
   CLIENT_ORIGIN=http://localhost:5173
   ```

## Project Structure

- `/client`: React frontend (Vite)
- `/server`: Express backend
- `/api`: Vercel serverless functions
- `/vercel.json`: Vercel configuration
