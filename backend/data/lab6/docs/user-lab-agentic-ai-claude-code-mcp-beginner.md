# Lab Agentic Ai Claude Code Mcp Beginner (1)

H A N D S - O N  L A B
Build Your First Agentic AI Application
Using Claude Code and the Model Context Protocol (MCP)
Jothi Periasamy
Chief Agentic AI Architect and Anthropic Claude Ambassador
Welcome. In this lab you will build your first AI agent. It will read real data, think about it, and write a 
document for you. This takes about 60 minutes. You do not need any AI experience. You only need to be able 
to type commands into a terminal. Every command you need is written out for you. Copy them exactly.
Lab Detail Description
Duration Approximately 60 minutes
Level Beginner. No AI or agent experience needed.
You will need A laptop, a terminal, and a paid Claude account (Pro, Max, or Team).
What you build A Release Notes Agent that reads a Git repository and drafts release notes.
What you learn How an agent works, how to connect it to real tools, and when to use AI.
1. Before You Start: Two Ideas That Matter
Idea 1: An agent is a loop, not a chatbot
You have used a chatbot before. You ask a question, it gives an answer, and it stops. An agent is different. An 
agent does work for you. It makes a plan, does something real (like opening a file), checks whether that 
worked, and then decides what to do next. It keeps going until the job is finished.
Every agent you will ever build runs this same cycle:
   Plan  ->  Act (call a tool)  ->  Observe result  ->  Decide
     ^                                                   |
     +---------------------------------------------------+
                     (repeat until done)
Claude Code is an agent. When you ask it to fix a problem in your code, it opens your files, runs your tests, 
sees what failed, and tries again on its own. You will watch this happen in Exercise 1.
Idea 2: The AI is only part of the system
This is the most important idea in this lab. If you remember one thing, remember this.
An AI agent does two very different kinds of work. Some steps are done by normal computer code. Other 
steps are done by the AI model. They behave differently:
Steps done by normal code Steps done by the AI model
Give it the same input, you always get the same output Give it the same input, the answer changes a little each 
time
Opening a file, running a search, saving a document Summarizing, sorting things into groups, deciding what 
is important
Copyright (c) LLM at Scale.AI  |  Page 1

Steps done by normal code Steps done by the AI model
You test these the normal way You check these by reviewing examples
Free and instant Costs money and takes a moment
A well built agent uses normal code wherever it can, and asks the AI model only when real thinking is needed. 
In this lab, MCP does the code part (getting real data) and Claude does the thinking part (deciding what 
matters and how to explain it).
Simple rule: if normal code can do the job, let normal code do it. Do not ask an AI model to add two numbers together.
So what is MCP?
MCP stands for Model Context Protocol. It is a way to connect an AI agent to real tools and real data. Without 
MCP, the AI only knows what it learned during training, plus whatever you paste into the chat. With MCP, the 
AI can look things up in your own systems directly.
A simple comparison: MCP is like a USB port. A USB port lets you plug any keyboard into any computer 
without special software. MCP lets you plug any tool into any AI agent the same way.
2. Setup (10 minutes)
Please finish this section before the lab begins. If something does not work, ask the instructor. Do not spend 
lab time stuck here.
Step 2.1 Install Claude Code
The native installer is the recommended method and needs nothing else installed first.
# macOS and Linux
curl -fsSL https://claude.ai/install.sh | bash
 
# Windows PowerShell
irm https://claude.ai/install.ps1 | iex
If your team standardizes on npm instead, that path is supported too, but it requires Node.js 22 or later:
node --version                          # must be v22 or higher
npm install -g @anthropic-ai/claude-code
Important: do not put the word sudo in front of these commands. It causes permission problems that are hard to undo. If 
you see a permission error, use the first installer above instead.
Step 2.2 Verify and sign in
claude --version
claude                                  # then follow the sign-in prompt
Claude Code requires a paid Claude plan (Pro, Max, or Team) or an API key from the Anthropic Console. The 
free plan does not include Claude Code.
Step 2.3 Create a lab folder
mkdir claude-lab && cd claude-lab
git init
echo "# Payments Service" > README.md
git add . && git commit -m "Initial commit"
Copyright (c) LLM at Scale.AI  |  Page 2

3. Exercise 1: Watch the Agent Loop (10 minutes)
Goal: see the difference between an answer and an action.
Task
Start Claude Code inside your lab folder and give it this prompt:
Create a Python script called inventory.py that reads a CSV of
parts and reports which items are below their reorder threshold.
Then create a small sample CSV and run the script to prove it works.
What to watch for
Do not read the code yet. Just watch what Claude Code does. It will write the file, run it, and if there is an 
error, it will read that error and fix the problem by itself. Nobody told it to do that.
• Which steps were done by normal code? (Writing the file, running it, reading the result.)
• Which step needed the AI model? (Deciding how to write the script in the first place.)
• How many times did the loop go around before it worked?
Discussion (3 minutes)
A chatbot would have given you code and stopped. You would not know if it worked until you tried it yourself. 
The agent actually ran the code and proved it works. That is the difference.
4. Exercise 2: Connect a Real Tool with MCP (15 minutes)
Goal: connect the agent to real information that it never learned during training.
Step 4.1 Add an MCP server
We will connect to the Claude Code documentation server. It needs no password and no setup, so it is a good 
first one to try. Type this in your terminal. Do not type it inside a Claude session.
claude mcp add --transport http claude-code-docs https://code.claude.com/docs/mcp
The name claude-code-docs is one you choose. Calling it docs would work identically.
Step 4.2 Verify the connection
claude mcp list          # run in the terminal
 
# Or start a session and check from inside:
claude
/mcp                     # run inside the Claude session
You should see the server listed as connected. If it says failed to connect, check the web address for typing 
mistakes. Then remove it and add it again.
Step 4.3 Use it
Inside a Claude session, ask something the model cannot answer from memory:
Using the docs server, what MCP scopes does Claude Code support,
and when should I use project scope instead of user scope?
Look at the answer carefully. You will see the server name appear where the agent used the tool. That is the 
agent going out and fetching real information instead of guessing.
Copyright (c) LLM at Scale.AI  |  Page 3

What just happened
The AI did not guess the answer. It looked it up. This is the whole point of MCP. An AI without tools can sound 
very confident and still be wrong. An AI with tools can check.
Good to know: local scope means only you can use the server. Project scope means your whole team can use it, through a 
file called .mcp.json in the project. User scope means you can use it in all of your own projects.
5. Exercise 3: Build the Release Notes Agent (20 minutes)
Goal: put the loop and the tool together and build something genuinely useful.
The problem
When a software team releases a new version, someone has to write release notes. These explain what 
changed for the people who use the software. Someone must read through every code change and describe it 
in plain language. It is slow and boring, so it often gets skipped or done badly. This is a good job for an agent: 
the information is already there, the thinking needed is real but simple, and nobody wants to do it.
Step 5.1 Create some history to work with
echo "def refund(amount): return amount" > payments.py
git add . && git commit -m "Add refund handler for partial refunds"
 
echo "def retry(): pass" >> payments.py
git add . && git commit -m "Fix timeout on gateway retry, closes TICKET-4471"
 
echo "# config" > config.py
git add . && git commit -m "Bump dependency versions"
Step 5.2 Give the agent the task
Read the git commit history in this repository and draft release
notes for version 1.2.0.
 
Group the changes under Features, Fixes, and Maintenance.
Write for a non-technical audience: say what changed for the user,
not what changed in the code. Skip anything purely internal.
 
Save the result as RELEASE_NOTES.md, then show me the file.
Step 5.3 Now make it better
The first draft will be okay but not great. That is expected. Now ask for improvements:
The Fixes section is too vague. For each fix, explain what the user
would have experienced before the fix. Keep each entry to one line.
This is the skill worth practicing. You are not trying to write one perfect instruction. You are guiding the agent 
step by step, the same way you would guide a new team member: give feedback, and ask for a better version.
Step 5.4 Sort the work into two kinds
Now look back at what just happened. Sort each step into the two kinds of work from Idea 2:
Step Normal code, or AI model?
Reading the list of code changes Normal code. It is just a command. Same result every time.
Deciding if a change is a new feature or a fix AI model. This needs judgment.
Putting them into groups Normal code, once the AI has sorted them.
Copyright (c) LLM at Scale.AI  |  Page 4

Step Normal code, or AI model?
Rewriting it in plain language AI model. This is where the real value is.
Saving the file Normal code.
In a real system at work, you would write the data collecting steps as normal code and ask the AI model only 
for the two thinking steps. This matters: AI model calls cost money each time. Using the model only where it 
is truly needed is what keeps a real system affordable.
6. What You Just Learned
• An agent works in a loop: plan, do something, check the result, decide what is next. Claude Code does this 
in your terminal.
• MCP connects an agent to real tools and real data. It took you one command and no programming.
• Every AI agent mixes normal code steps with AI model steps. Knowing which is which is the most 
important skill you learned today.
• Guiding the agent step by step works better than trying to write one perfect instruction.
7. Take It Further
Pick one and try it this week:
• Try it on a real project at work. Generate release notes for a version your team already shipped, then 
compare them with what a person wrote.
• Connect a second MCP server, such as GitHub, and ask the agent to match code changes against open 
tickets.
• Think of a boring task someone on your team does every week. Write down which steps are normal code 
and which need an AI model. That list is your first agent design.
8. Troubleshooting
Symptom Fix
command not found: claude Restart your terminal. If it persists, check that the install directory is on 
your PATH.
MCP server shows failed to connect Compare the URL to the documented endpoint. Then claude mcp 
remove <name> and re-add.
EBADENGINE warning during npm install Your Node.js is older than 22. Install a current version or use the native 
installer.
Permission errors on install You used sudo. Do not. Use the native installer or set npm's prefix to a 
directory you own.
The agent wants to change a file you did 
not expect
Claude Code always asks before it changes anything. Read what it is 
asking. Say no if it looks wrong.
(c) LLM at Scale.AI. All rights reserved.
Copyright (c) LLM at Scale.AI  |  Page 5

Author: Jothi Periasamy, Chief Agentic AI Architect and Anthropic Claude Ambassador
Commands and requirements verified against Anthropic documentation as of July 15, 2026. Claude Code and MCP evolve 
quickly; check docs.claude.com if a command behaves differently.
Copyright (c) LLM at Scale.AI  |  Page 6