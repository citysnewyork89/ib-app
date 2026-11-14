# Iberia Panel (publisher + helpline)

Web panel + Discord bot. Sign-in page, main menu and four sections:

1. **Publish texts** – compose/publish/edit messages. Templates now also store the images you upload.
2. **Ticket & helpline settings** – AI suggestions, claim system, knowledge base, embeds, messages, snippets.
3. **Settings** – bot status (Watching…, Playing…, online/idle/dnd) and your password.
4. **Users** – create, edit, suspend, reactivate and delete panel users (Administrator or Editor).

## Environment variables
`DISCORD_TOKEN`, `GUILD_ID`, `ADMIN_USERNAME` (default `admin`), `ADMIN_PASSWORD` (20+ chars), `MONGODB_URI`, optional `GEMINI_API_KEY`.
The main administrator is defined by `ADMIN_USERNAME` / `ADMIN_PASSWORD`; other users are created in the panel.

## Discord setup (important)
- Developer Portal → Bot → enable **Message Content Intent**.
- Bot permissions in the ticket category: View Channel, Read Message History, Send Messages, Embed Links, Mention Everyone (for @here).
- Ticket category: `1278071501752373268`, modmail bot: `1342157916521762898` (both editable in the panel).
- The modmail bot has its own `?claim`; disable or rename it there so both bots do not answer the same command.

## How the ticket system works
1. The modmail bot creates a channel in the category and posts the user info embed (`User ID: …`). The bot sends `@here`, then an English AI **Reply Suggestion** embed (copyable reply + copyable snippet commands) and a **Claim this inquiry** embed with a button.
2. `?claim` / the button claims a ticket. `?addmeclaim` adds another claimer. Claiming a claimed ticket shows the "already claimed" message.
3. A claimer with no message after 10 minutes is automatically unclaimed.
4. Writing without claiming (except the allowed user IDs) shows the infraction warning.
5. If the customer replies and the claimers stay silent, claimers get a DM every 24 hours.
6. `?suggestion` in a ticket gives a new suggestion based on the conversation.
Customer/staff messages are recognised from the modmail embeds (footer "Message ID" = customer, "Response/Staff/Note" = staff).

## AI & knowledge
- Gemini is the main provider (free key: aistudio.google.com/apikey). You can add Groq, OpenRouter, Cerebras, Mistral, DeepSeek or any OpenAI-compatible URL. Mode **Fallback** uses the first that works; **Ensemble** asks all and merges.
- The knowledge base reads iberiaroblox.com (+ /jobs, /helpcenter, sitemap), Discord channels (and the Google Docs / YouTube / site links inside them) and extra links you add. Job questions also read /jobs live. The ticket category is never read.
- Links and emails that are not in the knowledge base are removed from suggestions; emojis are stripped.
- Use the **Test & tickets** tab to try it without opening a ticket.

## Render + UptimeRobot
Repo on GitHub → Render → New + → Blueprint → fill the variables. UptimeRobot: HTTP monitor to `https://YOUR-APP.onrender.com/health` every 5 min.
