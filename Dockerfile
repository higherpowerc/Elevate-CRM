# Elevate CRM — production container
# Deployed on Render (runtime: docker); Render injects PORT at runtime.
FROM oven/bun:1

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json bun.lock ./
RUN bun install

# Copy application source
COPY server/ server/
COPY src/ src/
COPY index.html tsconfig.json ./

# Build the client bundle into dist/
RUN bun run build

# Render overrides PORT at runtime; 3001 is the local default
EXPOSE 3001

CMD ["bun", "run", "start"]
