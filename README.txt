WHISPER ROOM

Publish as a public website
1. Create a GitHub repository and upload the contents of this folder to its root.
   The render.yaml file must be at the top level of the repository.
2. Sign in to Render and choose New > Blueprint.
3. Connect the repository and deploy the whisper-room service.
4. Render will give the site a public onrender.com address. Share a room's
   invite link to let someone else join.

Render deploy guide: https://render.com/docs/your-first-deploy

Run it on your computer
1. Install Node.js if needed.
2. Open a terminal in this folder and run: npm start
3. Visit http://localhost:3000

Important limits
- Messages are held in server memory and disappear when the service restarts.
- Keep this as a single server instance; rooms are not synchronized across
  multiple instances.
- There is no end-to-end encryption. The room code is an invitation, not a
  password: anyone with the link can join. Do not use it for sensitive secrets.
- No account system, durable storage, or abuse controls are included yet.
