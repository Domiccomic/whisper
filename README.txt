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

Chat features
- Anonymous nicknames, live typing and read indicators, and message reactions.
- Shared room color themes and quick polls.
- Voice notes and photos (each upload is limited to about 1.2 MB).
- One time messages reveal to the first person who opens them, then clear.
- Schedule text messages up to 24 hours ahead.
- Close and clear a room for everyone with the panic close button.
- Regular message expiry options: 10 minutes, 1 hour, 1 day, or never.

Voice recording needs HTTPS (provided by Render) and browser microphone access.
Scheduled messages, rooms, and uploaded media are in memory and are lost if the
service restarts. The panic close cannot be undone for that room code.

More chat controls
- Quiet mode hides you from the online count and suppresses browser alerts.
- Enable browser alerts explicitly; they appear only when the tab is away and
  browser permission has been granted.
- Reply to messages with a quote that jumps back to the original. Edit or unsend
  your own text messages; the server checks who sent each message.
- Emoji picker inserts emoji in messages. Add Favorite saves personal emoji for
  quick reactions on this browser; those reactions are visible to everyone.

Calling
- Start a one-to-one voice or video call from the phone button in the room.
- Calls use browser WebRTC. Whisper relays call invitations and connection
  setup, while call audio/video travels directly between participants.
- Calls are not recorded by this app. Direct calls can expose each participant's
  network address to the other participant and the public STUN service.
- Camera and microphone permissions are needed. The current setup uses public
  STUN servers without a TURN relay, so some restrictive networks may not
  connect successfully.

Message organization
- Search the messages currently in a room and pin one shared message.
- Save messages in this browser, copy their text, or forward a text summary
  into the current room. Saved items are local to this browser and room.
- Messages that expire or are unsent are automatically removed from the pin.

Local preferences
- Configure read receipts, typing indicators, notification previews and sounds.
- Adjust text size, contrast, reduced motion, color, backdrop and voice playback speed.
- Save drafts, use quick replies, and show unread message counts in the page title.
- Preferences, drafts and saved messages live in this browser. They do not sync.
- Record and share 10-second video clips, add captions to photos/videos, and send a one-time location or contact card when you choose.
- Add image and animated-GIF stickers to a personal sticker pack; sent stickers are shared as room images.
- Install Whisper as a home-screen app. The shell loads offline; messages need a connection, while drafts remain on the device.
