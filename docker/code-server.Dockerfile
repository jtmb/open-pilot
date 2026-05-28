FROM codercom/code-server:latest

USER root

# Install Node.js 20.x LTS + npm so the worker agent can run npm/npx commands
RUN apt-get update && apt-get install -y curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install common tools workers may need
RUN apt-get update && apt-get install -y git python3 python3-pip lsof \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Pre-create workspace root so exec CWD is always valid
RUN mkdir -p /home/coder/workspace && chown coder:coder /home/coder/workspace

# Pre-create code-server directories so Docker volume mounts of subdirectories
# (copilot-bridge, User/settings.json) don't create parent dirs owned by root,
# which would crash the extension host on startup.
RUN mkdir -p \
    /home/coder/.local/share/code-server/extensions \
    /home/coder/.local/share/code-server/User/History \
    /home/coder/.local/share/code-server/User/globalStorage \
    /home/coder/.local/share/code-server/logs \
    && chown -R coder:coder /home/coder/.local

USER coder
