<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->
- [x] Verify that the copilot-instructions.md file in the .github directory is created. (copilot-instructions.md created and verified)

- [ ] Initialize Git Repository
	<!--
	Run `git init` in the project root at the very start of the project.
	Create a .gitignore file appropriate for the project type (Node.js, Python, etc.).
	Make an initial commit with the message "Initial commit".
	Create a remote repository (e.g. on GitHub using the gh CLI: `gh repo create`) and push the initial commit to the remote.
	-->

- [x] Clarify Project Requirements (Next.js, TypeScript, Tailwind CSS, NextAuth.js, Docker, code-server, Copilot integration)

- [x] Scaffold the Project (Next.js app, Docker, Tailwind, NextAuth, code-server, initial structure and build verified)

- [ ] Customize the Project
	<!--
	Verify that all previous steps have been completed successfully and you have marked the step as completed.
	Develop a plan to modify codebase according to user requirements.
	Apply modifications using appropriate tools and user-provided references.
	Skip this step for "Hello World" projects.
	-->
	(in progress)

- [x] Install Required Extensions (No extensions needed)

- [x] Compile the Project (All dependencies installed, build and type checks pass, project compiles successfully)

- [x] Create and Run Task
	<!--
	Created dev and build tasks for the web app in .vscode/tasks.json.
	-->

- [x] Launch the Project
	<!--
	Project launched using Docker Compose. Web app and code-server running in containers.
	-->

- [x] Ensure Documentation is Complete
	<!--
	README.md and copilot-instructions.md exist and are up to date. Project information documented.
	-->

<!--
## Execution Guidelines
PROGRESS TRACKING:
- If any tools are available to manage the above todo list, use it to track progress through this checklist.
- After completing each step, mark it complete and add a summary.
- Read current todo list status before starting each new step.

COMMUNICATION RULES:
- Avoid verbose explanations or printing full command outputs.
- If a step is skipped, state that briefly (e.g. "No extensions needed").
- Do not explain project structure unless asked.
- Keep explanations concise and focused.

DEVELOPMENT RULES:
- Use '.' as the working directory unless user specifies otherwise.
- Initialize a git repository (`git init`, create `.gitignore`, make an initial commit, create a remote repo with `gh repo create`, and push) at the very beginning of every new project, before scaffolding.
- Avoid adding media or external links unless explicitly requested.
- Use placeholders only with a note that they should be replaced.
- Use VS Code API tool only for VS Code extension projects.
- Once the project is created, it is already opened in Visual Studio Code—do not suggest commands to open this project in Visual Studio again.
- If the project setup information has additional rules, follow them strictly.

FOLDER CREATION RULES:
- Always use the current directory as the project root.
- If you are running any terminal commands, use the '.' argument to ensure that the current working directory is used ALWAYS.
- Do not create a new folder unless the user explicitly requests it besides a .vscode folder for a tasks.json file.
- If any of the scaffolding commands mention that the folder name is not correct, let the user know to create a new folder with the correct name and then reopen it again in vscode.

EXTENSION INSTALLATION RULES:
- Only install extension specified by the get_project_setup_info tool. DO NOT INSTALL any other extensions.

PROJECT CONTENT RULES:
- If the user has not specified project details, assume they want a "Hello World" project as a starting point.
- Avoid adding links of any type (URLs, files, folders, etc.) or integrations that are not explicitly required.
- Avoid generating images, videos, or any other media files unless explicitly requested.
- If you need to use any media assets as placeholders, let the user know that these are placeholders and should be replaced with the actual assets later.
- Ensure all generated components serve a clear purpose within the user's requested workflow.
- If a feature is assumed but not confirmed, prompt the user for clarification before including it.
- If you are working on a VS Code extension, use the VS Code API tool with a query to find relevant VS Code API references and samples related to that query.

AGENTS.md RULES:
- Every new project MUST have an AGENTS.md file at the project root.
- Populate AGENTS.md with project-specific information gathered during scaffolding:
  - Architecture: tech stack, key directories and their purpose.
  - Build & Run: how to install dependencies, run dev server, build for production.
  - Environment variables: list all required env vars and what they do.
  - Testing: testing strategy, commands, and what is/isn't covered.
  - CI: describe the CI pipeline and what it checks.
- If AGENTS.md already exists and contains user-provided content, NEVER overwrite it.
  Append new sections or update existing ones using the existing structure.
- Keep entries factual and concise — this file is read by agents on every task.

TASK COMPLETION RULES:
- Your task is complete when:
  - Project is successfully scaffolded and compiled without errors
  - copilot-instructions.md file in the .github directory exists in the project
  - README.md file exists and is up to date
  - AGENTS.md exists at the project root and contains accurate project notes
  - User is provided with clear instructions to debug/launch the project

Before starting a new task in the above plan, update progress in the plan.
-->
- Work through each checklist item systematically.
- Keep communication concise and focused.
- Follow development best practices.
