# Changelog

All notable changes to the SKB Service will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2-beta] - 2023-08-05

### Added
- Alias map hot-reload functionality:
  - Auto-reload alias map file via fs.watchFile
  - Reload on SIGHUP signal
  - Mutex protection to prevent concurrent reloads
  - New /alias health endpoint
  - New metrics for monitoring reloads and errors
- File watcher with debounce for alias map changes
- Internal event emission on successful reloads
- Automated test for SIGHUP-triggered reloads

### Changed
- GraphStore now supports real-time alias map updates
- Improved logging for alias map operations
- Updated documentation with alias map hot-reload info

## [0.3.1-beta] - 2023-07-30

### Added
- Incremental append operations for efficient file I/O
- Automatic compaction engine to keep global graph file size bounded
- Concurrency protection for all file operations
- New health endpoint `/graph` with status reporting
- New environment variables for configuration:
  - COMPACT_THRESHOLD: Number of merges before compaction (default: 500)
  - COMPACT_MB_LIMIT: File size in MB that triggers compaction (default: 20)
  - MAX_GRAPH_MB: Maximum file size before critical status (default: 100)
  - FSYNC: Enable fsync for durability (default: false)
- Worker shutdown hook to force final compaction
- Load test with 5000 notes to verify performance
- New metrics:
  - global_graph_file_bytes: Size of the global graph file in bytes
  - graph_compaction_time_seconds: Duration of compaction operations

### Changed
- GraphStore now tracks deltas and only appends new data
- Health endpoint returns degraded/critical status based on file size
- Mutex protection for all file operations

## [0.3.0] - 2023-07-15

### Added
- Global knowledge graph consolidation 
- GraphStore class for managing the unified knowledge graph
- Entity deduplication with normalization and alias resolution
- Alias mapping support via alias_map.yml file
- Real-time graph updates as fragments are processed
- graph_updated event emission for downstream consumers
- File-backed persistence with JSON-Lines format
- Automatic graph recovery if corrupted on boot
- New metrics for the global graph:
  - graph_nodes_total: total number of nodes in the global graph
  - graph_edges_total: total number of edges in the global graph
  - alias_hits_total: number of successful alias resolutions
  - merge_conflicts_total: number of conflicts during merging
- Unit and integration tests for global graph features

### Changed
- Worker now merges fragments into the global graph after processing
- Version bumped to 0.3.0 to reflect the major feature addition
- Updated README with global graph documentation

## [0.2.0] - 2023-06-01

### Added
- Persistence & idempotency for fragment storage
- FragmentStore class to load and track fragments
- Boot-time fragment loading from FRAGMENT_DIR
- In-memory fragment tracking that survives restarts
- Fragment count metrics for monitoring
- reindex-note.ts utility for force re-processing
- Unit and integration tests for persistence features

### Changed
- Worker now checks in-memory cache rather than disk for faster duplicate detection
- Updated README with persistence and restart documentation

## [0.1.0] - 2023-05-12

### Added
- Initial release of the SKB Service (Milestone M1)
- Event-driven architecture to process note events
- Contract-first approach with JSON schema validation
- NATS messaging integration with reconnect handling
- Duplicate event detection within a 5-minute window
- Express server for health checks and metrics
- Prometheus metrics endpoint with custom counters
- GitHub Actions CI pipeline for automated testing and image building
- Docker and Docker Compose configurations for development and staging
- Integration and chaos tests for reliability verification
- Graceful shutdown handling

### Technical Features
- TypeScript for type safety
- Node.js runtime
- AJV for JSON Schema validation
- NATS client for messaging
- Express for HTTP endpoints
- Prometheus client for metrics
- Docker containerization
- ESLint and Prettier for code quality
- Jest for testing

## Note
This is the initial release focusing on the service skeleton and infrastructure. 
The actual knowledge base indexing functionality will be implemented in upcoming releases.