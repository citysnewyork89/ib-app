// Default settings for the helpline system. Everything here can be edited from the web panel.
const SNIPPETS = [
  { name: 'beforeclosing', desc: 'Sent before closing a ticket: says the request has been resolved and asks whether the customer needs anything else or if the ticket can be closed.', after: '' },
  { name: 'cabincrewjob', desc: 'Form for someone applying for Cabin Crew.', after: '' },
  { name: 'cadetjob', desc: 'Form for someone applying to be a pilot (cadet).', after: '' },
  { name: 'groundcrewjob', desc: 'Form for someone applying for Ground Crew.', after: '' },
  { name: 'highrankjob', desc: 'Form for someone applying for a High Rank position, e.g. department director or public relations.', after: '' },
  { name: 'technicianjob', desc: 'Form for someone applying to be a technician at Iberia or to join the marketing team.', after: '' },
  { name: 'inactivityalert', desc: 'Alert telling the user they will be considered inactive and the ticket will close in 48 hours if they do not reply.', after: '' },
  { name: 'jobapplicationaccepted', desc: 'Notifies the user that a job application at Iberia (any position) has been accepted.', after: '' },
  { name: 'jobapplicationdeclined', desc: 'Notifies the user that a job application at Iberia (any position) has been declined.', after: '' },
  { name: 'newticket', desc: 'Greeting for a person who just opened a ticket: "Hello, you are now speaking with an agent from Iberia customer service. How can I help you?"', after: '' },
  { name: 'onboardclasses', desc: 'Lists all available onboard classes (Iberia, Iberia Express and Iberia Regional Air Nostrum) with prices, benefits and Roblox passes to purchase.', after: '' },
  { name: 'partneraccepted', desc: 'Notifies the user that a partner application has been accepted.', after: '' },
  { name: 'partnerdeclined', desc: 'Notifies the user that a partner application has been declined.', after: '' },
  { name: 'partnerform', desc: 'Form sent when someone wants to become an Iberia partner (lists the requirements set by the Public Relations Department).', after: 'transferredtopublicrelationsdepartment' },
  { name: 'reportform', desc: 'Form for appealing a ban or reporting any type of action (about staff, passengers or a group).', after: '' },
  { name: 'transferredtopublicrelationsdepartment', desc: 'Tells the user that their case was transferred to the Public Relations Department.', after: '' },
  { name: 'transferredtotalentdepartment', desc: 'Tells the user that their case was transferred to the Talent Department.', after: '' },
  { name: 'underreview', desc: 'Sent when someone submits a form (job, partner, etc.) to confirm it was received and forwarded, and that they will get an answer as soon as possible.', after: '' }
];

const RULES = `You are the Iberia customer support assistant. You help staff of Iberia Líneas Aéreas de España (a Roblox airline community) answer tickets that customers open through a Discord modmail system.

STRICT RULES
- Write ONLY in English.
- Use correct Discord markdown where useful: **bold**, [text](https://link), and lists with "- ". NEVER use emojis, emoticons or keyboard icons.
- Be professional, warm and concise. Write the reply exactly as the staff member would send it to the customer.
- Use ONLY the information contained in the KNOWLEDGE, LIVE PAGE and ADMIN NOTES sections. NEVER invent facts, prices, requirements, vacancies, links, emails or policies. Only include links that literally appear in that information.
- If the information needed is not available, do not guess: ask a short clarifying question or say that the team will review it.
- Commercial matters (selling a product, buying Iberia, offers or business proposals, sponsorships) must be redirected to {businessEmail}.
- Questions about the status of a job application or job request that was already submitted must be redirected to {recruitmentEmail}.
- For people who want to apply for a job, use the live jobs page to name the vacancies that are currently open and link to the jobs page.
- If one or more snippets fit the situation, return them in "commands" (names only, from the AVAILABLE SNIPPETS list). If a snippet fully covers the answer, "reply" can be a short introduction or empty.
- Reply to the customer's latest message. If the customer only says thanks or the conversation needs no answer, keep the reply short or empty.
- Keep the reply under {maxChars} characters.`;

const helpline = {
  general: {
    categoryId: '1278071501752373268',
    modmailBotId: '1342157916521762898',
    allowedUsers: ['1199410946163097653', '1259840751450456116'],
    prefix: '?',
    claimTimeoutMin: 10,
    reminderHours: 24,
    warnCooldownSec: 30,
    firstSuggestionDelaySec: 8,
    autoSuggest: true,
    claimWarnings: true,
    warnWhenUnclaimed: false,
    reminders: true
  },
  ai: {
    mode: 'fallback',
    temperature: 0.3,
    maxReplyChars: 1500,
    businessEmail: 'business@iberiaroblox.com',
    recruitmentEmail: 'recruitment@iberiaroblox.com',
    systemRules: RULES,
    extraKnowledge: '',
    providers: [
      { id: 'gemini', name: 'Google Gemini', type: 'gemini', enabled: true, model: 'gemini-2.5-flash', baseUrl: '', apiKey: '' },
      { id: 'groq', name: 'Groq (free tier)', type: 'openai', enabled: false, model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1', apiKey: '' },
      { id: 'openrouter', name: 'OpenRouter (free models)', type: 'openai', enabled: false, model: 'meta-llama/llama-3.3-70b-instruct:free', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '' },
      { id: 'deepseek', name: 'DeepSeek', type: 'openai', enabled: false, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', apiKey: '' }
    ]
  },
  knowledge: {
    siteUrls: ['https://iberiaroblox.com', 'https://iberiaroblox.com/jobs', 'https://iberiaroblox.com/helpcenter'],
    jobsUrl: 'https://iberiaroblox.com/jobs',
    extraUrls: [],
    maxPages: 60,
    includeDiscord: true,
    excludeChannelIds: [],
    maxMessagesPerChannel: 300,
    refreshHours: 12
  },
  embeds: {
    ticketAlert: { content: '@here', title: 'New ticket opened', description: 'A new inquiry has been opened by {owner} (`{ownerId}`). Please review the details above.', color: '#1c1c1c', footer: '', thumbnail: '', image: '', timestamp: false },
    suggestion: {
      title: 'Reply Suggestion',
      description: '> The AI system has generated a suggested reply for this ticket, based on information from the Iberia website. This reply was generated by AI, so it is advisable to review it before sending it to the customer.',
      commandsTitle: 'Suggested commands',
      afterText: 'Afterwards, once {snippet} has been executed, run the command {after}.',
      emptyText: 'No written reply is suggested for this message. Use the suggested commands below.',
      color: '#1c1c1c', footer: '', thumbnail: '', image: '', timestamp: false
    },
    claim: {
      title: 'Claim this inquiry',
      description: '> To avoid misunderstandings and problems, if you are going to answer this ticket you must claim it before talking in it. If you claim it and do not reply within {timeout} minutes, it will be unclaimed and you may receive a sanction.',
      buttonLabel: 'Claim ticket', buttonStyle: 'Secondary',
      color: '#1c1c1c', footer: '', thumbnail: '', image: '', timestamp: false
    }
  },
  messages: {
    claimSuccess: '<:3_:1332753435766030406> The user {claimer} has **successfully claimed** this ticket.',
    addClaimSuccess: '<:3_:1332753435766030406> The user {claimer} has **joined** this claimed ticket. Claimed by: {claimers}.',
    alreadyClaimedByYou: 'You have already claimed this ticket.',
    alreadyClaimed: '<:image56:1343277287193317481> Sorry, this ticket is already claimed by {claimers}.',
    autoUnclaim: '<:2_:1332753436994961441> **The system has unclaimed** this ticket because the user {claimer} has not responded. If you want to claim this ticket, run the command ?claim',
    notClaimedWarning: '<:image56:1343277287193317481> **Remember,** this ticket is claimed by {claimers}. You are committing an infraction because you have not claimed this ticket. If you think this is a mistake, contact a high rank.',
    dmReminder: '<:image56:1343277287193317481> The ticket {channel} is pending a reply, please respond to it. If you do not need it, or it is not within your reach, ignore this notification.',
    suggestionError: 'The AI could not generate a suggestion right now. Please try again in a moment.',
    notATicket: 'This channel is not a tracked ticket.'
  },
  snippets: SNIPPETS
};

const bot = { status: 'online', activityType: 'Watching', activityText: 'Iberia tickets' };

module.exports = { helpline, bot };
