import type { FoundationSkill } from '../../types.js';

export const DOCKER_PATTERNS: FoundationSkill = {
  name: 'docker-patterns',
  version: '1.0.0',
  target: 'dev',
  content: `### Docker Build Patterns
- Use multi-stage builds to separate the build environment from the runtime image; the final stage must contain only production artifacts and runtime dependencies
- Run the application as a non-root user (appuser with UID 1001); never run containers as root in production
- Add a HEALTHCHECK instruction to every service image so orchestrators (Kubernetes, ECS) can detect unhealthy containers and restart them
- Use dumb-init or tini as PID 1 to ensure proper signal forwarding and zombie process reaping inside the container
- Maintain a .dockerignore file that excludes node_modules, .git, test files, and local .env files from the build context
- Order Dockerfile layers from least to most frequently changed: base image, system deps, package manifest copy + install, then source code copy
- Pin base image versions to a specific digest or minor version tag; never use :latest in production Dockerfiles
- Set NODE_ENV=production in the runtime stage to disable development dependencies and enable production optimizations
- Minimize the number of RUN layers by chaining related commands; clean up package manager caches in the same layer to reduce image size`,
};
