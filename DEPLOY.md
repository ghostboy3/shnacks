# Deployment Guide for Vercel

## Quick Deploy

1. **Install Vercel CLI**:
   ```bash
   npm i -g vercel
   ```

2. **Login**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   vercel
   ```

4. **Set Environment Variables** in Vercel Dashboard (Settings → Environment Variables):
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `CLIENT_ORIGIN`: Your Vercel URL (optional, defaults to *)

5. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

## Project Structure for Vercel

- `/api`: Serverless functions (wraps Express app)
- `/client`: React frontend (Vite)
- `/server`: Express backend (used by API functions)
- `/vercel.json`: Vercel configuration

## Important Notes

1. **In-Memory Storage**: The current implementation uses in-memory storage (`userStores` Map), which resets on each serverless function cold start. For production, consider using:
   - Redis
   - Vercel KV
   - External database

2. **File Uploads**: PDF uploads work but are stored in memory. For production, consider:
   - Vercel Blob Storage
   - AWS S3
   - Firebase Storage

3. **Environment Variables**: Make sure to set `OPENAI_API_KEY` in Vercel dashboard.

## Troubleshooting

- If API routes don't work, check that `/api/index.js` properly exports the Express app
- If CORS errors occur, verify `CLIENT_ORIGIN` is set correctly
- Check Vercel function logs for errors
