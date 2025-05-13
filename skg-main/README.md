# SKB Service

![CI Status](https://github.com/organization-name/skb-service/workflows/CI/badge.svg)
![Docker Image Size](https://img.shields.io/docker/image-size/ghcr.io/organization-name/skb-service/latest)
![Version](https://img.shields.io/badge/version-0.3.1--beta-blue)

Sorting Knowledge Base (SKB) Service is a microservice that listens for Tangent's new note events on the MCP bus, validates the payload against a schema, processes the content into knowledge graph fragments, consolidates fragments into a unified global knowledge graph, and publishes graph update events.

## Status

M3 Phase 1 completed - Global knowledge graph capabilities are now fully implemented with entity deduplication and merge functionality. The service maintains a consolidated graph across all notes, supports entity alias resolution, and emits graph_updated events for real-time tracking. The service provides both per-note fragments and a unified global graph for knowledge exploration. Requires Python + kg_gen CLI installed.

## Project Structure

```
skb-service/
├── src/
│   ├── config/        # Configuration settings
│   ├── fragment-store/ # Per-note fragment storage
│   ├── graph-store/   # Global knowledge graph management
│   ├── kggen/         # Knowledge graph generation utilities
│   ├── metrics/       # Prometheus metrics
│   ├── schemas/       # JSON schemas for messages
│   ├── types/         # TypeScript types (generated from schemas)
│   ├── utils/         # Utility functions
│   └── worker/        # Main service worker logic
├── scripts/           # Helper scripts
├── tests/
│   ├── fixtures/      # Test data fixtures
│   ├── integration/   # Integration tests
│   └── utils/         # Unit tests
├── .env.example       # Example environment configuration
├── .eslintrc.json     # ESLint configuration
├── .prettierrc        # Prettier configuration
├── package.json       # Project metadata and dependencies
└── tsconfig.json      # TypeScript configuration
```

## Getting Started

### Prerequisites

- Node.js 20.x
- pnpm
- Python 3.8+ (for KGGen CLI)
- KGGen CLI installed (`pip install kg-gen` or equivalent)
- OpenAI API key (for KGGen LLM access)

### Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   ```

2. Install dependencies:
   ```
   pnpm install
   ```

3. Copy the environment example file:
   ```
   cp .env.example .env
   ```

4. Configure the `.env` file with appropriate settings

### Development

- Generate TypeScript types from schemas:
  ```
  pnpm run gen:schema
  ```

- Build the project:
  ```
  pnpm run build
  ```

- Start the service locally:
  ```
  ./scripts/start-local.sh
  ```

- Run in development mode (with watch):
  ```
  pnpm run dev
  ```

- Run with Docker Compose:
  ```
  docker compose up
  ```

- Run smoke test (requires nats-cli):
  ```
  ./scripts/smoke.sh
  ```

- Force re-processing of a specific note:
  ```
  npx ts-node scripts/reindex-note.ts <note_id>
  ```

## Deployment

### Staging Deployment

Deploy the SKB service to a staging environment with a single command:

```bash
# Set the version you want to deploy
export SKB_VERSION=v0.1.0

# Deploy with docker-compose
docker-compose -f docker-compose.staging.yml up -d
```

This will start:
1. A NATS server for messaging
2. The SKB service connected to NATS

Verify the deployment is working:

```bash
# Check service health
curl http://localhost:3000/healthz

# View Prometheus metrics
curl http://localhost:3000/metrics
```

### Running Smoke Tests

Run a smoke test to verify the service is processing events correctly:

```bash
./scripts/smoke.sh
```

This will:
1. Send a valid note event
2. Send an invalid note event
3. Verify both receive appropriate acknowledgments

### Recovery

If the service needs to be restarted or recovered:

```bash
# Stop the services
docker-compose -f docker-compose.staging.yml down

# Start them again
docker-compose -f docker-compose.staging.yml up -d
```

### Monitoring

The service exposes:
- `/healthz` - Health check endpoint with memory usage and uptime
- `/graph` - Graph status endpoint with:
  - Entity and triple counts
  - File size in MB
  - Last compaction timestamp
  - Status: normal, degraded (>80% MAX_GRAPH_MB), critical (>MAX_GRAPH_MB)
  - Returns HTTP 503 when in critical state
- `/metrics` - Prometheus metrics including:
  - `skb_notes_processed_total` - Counter for processed notes
  - `skb_duplicates_detected_total` - Counter for duplicate events
  - `skb_validation_errors_total` - Counter for validation errors
  - `skb_processing_time_seconds` - Histogram for processing time
  - `skb_fragments_generated_total` - Counter for successful KG fragment generation
  - `skb_kggen_failures_total` - Counter for KGGen extraction failures
  - `skb_graph_nodes_total` - Gauge for total entities in global graph
  - `skb_graph_edges_total` - Gauge for total relationships in global graph
  - `skb_global_graph_file_bytes` - Gauge for global graph file size in bytes
  - `skb_alias_hits_total` - Counter for entity alias resolution hits
  - `skb_alias_map_reloads_total` - Counter for alias map hot-reloads
  - `skb_alias_map_reload_errors_total` - Counter for alias map reload errors
  - `skb_alias_map_reload_time_seconds` - Histogram for alias map reload duration
  - `skb_alias_map_size` - Gauge tracking current number of alias map entries
  - `skb_merge_conflicts_total` - Counter for conflicts during graph merging
  - `skb_graph_updates_total` - Counter for global graph update operations
  - `skb_graph_compactions_total` - Counter for graph file compactions
  - `skb_graph_compaction_time_seconds` - Histogram for compaction duration
  - `node_*` - Standard Node.js metrics

## Message Contracts

### New Note Event

The service listens for `new_note` events with the following structure:

```json
{
  "note_id": "123e4567-e89b-12d3-a456-426614174000",
  "content": "Note content text",
  "author_id": "123e4567-e89b-12d3-a456-426614174001",
  "timestamp": "2023-05-01T12:00:00Z",
  "metadata": {
    "title": "Optional note title",
    "tags": ["tag1", "tag2"],
    "workspace_id": "123e4567-e89b-12d3-a456-426614174002",
    "path": "/path/to/note"
  },
  "event_id": "123e4567-e89b-12d3-a456-426614174003"
}
```

### Note Indexed Response

The service responds with a `note_indexed` message:

```json
{
  "note_id": "123e4567-e89b-12d3-a456-426614174000",
  "event_id": "123e4567-e89b-12d3-a456-426614174004",
  "correlation_id": "123e4567-e89b-12d3-a456-426614174003",
  "status": "RECEIVED",
  "version": "0.1.0",
  "timestamp": "2023-05-01T12:00:05Z"
}
```

Status values:
- `RECEIVED` - Note was successfully received and validated
- `VALIDATION_FAILED` - Note failed schema validation
- `INTERNAL_ERROR_M1` - An internal error occurred during processing

### Note Fragmented Event

After processing a note for knowledge graph fragments, the service publishes a `note_fragmented` event:

```json
{
  "note_id": "123e4567-e89b-12d3-a456-426614174000",
  "event_id": "123e4567-e89b-12d3-a456-426614174005",
  "correlation_id": "123e4567-e89b-12d3-a456-426614174003",
  "status": "SUCCESS",
  "entities": 5,
  "relations": 3,
  "timestamp": "2023-05-01T12:00:08Z"
}
```

Status values:
- `SUCCESS` - Knowledge graph fragments were successfully generated
- `ERROR_KGGEN` - Error occurred during knowledge graph generation
- `SKIPPED_DUPLICATE` - Note was skipped because fragments already exist

### Graph Updated Event

When a fragment is merged into the global knowledge graph, the service publishes a `graph_updated` event:

```json
{
  "note_id": "123e4567-e89b-12d3-a456-426614174000",
  "event_id": "123e4567-e89b-12d3-a456-426614174006",
  "correlation_id": "123e4567-e89b-12d3-a456-426614174005",
  "timestamp": "2023-05-01T12:00:09Z",
  "total_entities": 240,
  "total_triples": 186,
  "added_entities": 3,
  "merged_entities": 2,
  "added_triples": 4,
  "conflicts": 0
}
```

This event contains valuable metrics about the global graph state:
- `total_entities` - Total number of entities in the global graph
- `total_triples` - Total number of relationships in the global graph
- `added_entities` - Number of new entities added from this fragment
- `merged_entities` - Number of entities deduplicated during merge
- `added_triples` - Number of new relationships added
- `conflicts` - Number of conflicts encountered during merge

### Consuming note_fragmented Events

To consume the `note_fragmented` events in your application:

1. Subscribe to the topic `events.skb.note.fragmented.v1`:
   ```typescript
   // Using NATS client
   const subscription = nc.subscribe('events.skb.note.fragmented.v1');
   for await (const msg of subscription) {
     const data = JSON.parse(msg.string());
     // Process event based on status
     if (data.status === 'SUCCESS') {
       // Fragment was successfully generated
       console.log(`Fragment for note ${data.note_id} generated with ${data.metrics.entities_count} entities`);
     } else if (data.status === 'ERROR_KGGEN') {
       // Handle error in knowledge graph generation
       console.error(`Failed to generate fragment for note ${data.note_id}`);
     } else if (data.status === 'SKIPPED_DUPLICATE') {
       // Note that duplicate was detected
       console.log(`Fragment for note ${data.note_id} already exists, skipped`);
     }
   }
   ```

2. These events provide real-time updates on the knowledge graph generation process, enabling consumers to track the fragment status and potentially trigger additional processing or visualization of the knowledge graph.

3. The `metrics` field provides valuable information about the complexity and processing time of the fragment, which can be used for monitoring and analytics.

### Knowledge Fragment Structure

The service generates knowledge fragments with the following structure:

```json
{
  "note_id": "123e4567-e89b-12d3-a456-426614174000",
  "entities": [
    {
      "id": "entity1",
      "label": "TypeScript",
      "type": "Technology"
    },
    {
      "id": "entity2",
      "label": "JavaScript",
      "type": "Technology"
    }
  ],
  "relations": [
    "is_superset_of",
    "is_used_in"
  ],
  "triples": [
    {
      "subject": "entity1",
      "predicate": "is_superset_of",
      "object": "entity2"
    }
  ]
}
```

The fragments are stored as JSON files in the configured `FRAGMENT_DIR` path.

## Resilience Features

- **Duplicate Detection**: The service tracks event IDs and detects duplicates within a 5-minute window
- **Broker Reconnection**: Automatically reconnects to NATS if the connection is lost
- **Payload Size Limits**: Enforces a 256 KiB maximum content size
- **Graceful Shutdown**: Proper cleanup of resources on shutdown
- **Error Handling**: Comprehensive error handling with proper logging and metrics
- **Restart Safety**: Loads fragments from disk at startup to maintain duplicate detection across restarts
- **Persistent Storage**: Stores fragments on disk in a mounted volume for durability
- **Re-indexing**: Provides a utility to force re-processing of specific notes when needed

## Knowledge Graph Features

### Per-Note Fragment Features
- **Fragment Generation**: Creates knowledge graph fragments from note content
- **Entity Extraction**: Identifies entities like people, organizations, concepts
- **Relation Detection**: Determines relationships between entities
- **Triple Storage**: Stores subject-predicate-object triples in a structured format
- **De-duplication**: Avoids re-processing notes with existing fragments
- **Persistence**: Fragments survive service restarts by loading from disk on initialization

### Global Graph Features
- **Consolidated Knowledge Graph**: Merges all fragments into a single unified graph
- **Entity Deduplication**: Combines identical entities using normalization
- **Alias Resolution**: Maps different terms to the same entity using alias_map.yml
- **Hot-Reload**: Reloads alias map on SIGHUP signal without service restart
- **Real-time Updates**: Merges fragments as they're generated
- **Graph Events**: Emits graph_updated events for consumers to track changes
- **Conflict Handling**: Gracefully handles and reports merge conflicts
- **Automatic Recovery**: Rebuilds from fragments if the global graph is corrupted
- **JSON-Lines Storage**: File-backed persistence using append-friendly format
- **Incremental Append**: Only appends deltas to avoid rewriting entire graph file
- **Automatic Compaction**: Periodically rewrites the graph file to reduce size
- **Concurrency Protection**: Prevents race conditions during append/compaction operations
- **Health Monitoring**: Exposes graph metrics including file size and compaction history
- **Shutdown Protection**: Forces final compaction during service shutdown

#### Compaction
The GraphStore implements automatic compaction of the global graph file to manage its size and improve read performance. Compaction is triggered by:
- Number of merge operations exceeding `COMPACT_THRESHOLD` (default: 500)
- File size exceeding `COMPACT_MB_LIMIT` (default: 20 MB)
- Explicit force compaction (used during graceful shutdown)

Metrics exposed:
- `skb_graph_compactions_total`: Counter of total compactions performed
- `skb_graph_compaction_time_seconds`: Histogram of compaction duration in seconds
- `skb_global_graph_file_bytes`: Gauge tracking the current file size in bytes

#### Shutdown Behavior
During graceful service shutdown (SIGTERM, SIGINT), the SKB worker:
1. Forces a final graph compaction to ensure all data is properly persisted
2. Closes all broker connections
3. Exits with the appropriate status code

This ensures that the global graph is in a consistent state when the service restarts.

#### Alias Map Hot-Reload
The GraphStore supports hot-reloading of the alias map without needing to restart the service:

1. The alias map file (`alias_map.yml`) maps normalized entity labels to canonical forms
2. Send a SIGHUP signal to the process to trigger a reload:
   ```bash
   kill -s SIGHUP <process_id>
   ```
3. The service:
   - Uses mutex protection to prevent concurrent reloads
   - Safely reloads the alias map without affecting ongoing operations
   - Updates metrics and health endpoints with new alias map information
   - Applies the new aliases immediately to subsequent entity resolutions

Metrics exposed:
- `skb_alias_map_reloads_total`: Counter tracking total reloads performed
- `skb_alias_map_reload_errors_total`: Counter tracking failed reload attempts
- `skb_alias_map_reload_time_seconds`: Histogram of reload duration in seconds
- `skb_alias_map_size`: Gauge tracking current number of alias map entries
- `skb_alias_hits_total`: Counter tracking alias resolution usage

## Using the Real KGGen Extractor

The service supports real knowledge graph extraction using the KGGen CLI tool. This provides production-quality entity and relation extraction using large language models.

### External Environment Setup (Recommended)

To set up KGGen in an external environment that doesn't bloat the repository:

1. Run the automated setup script:
   ```bash
   ./scripts/setup-external-venv.sh
   ```

   This will:
   - Create a virtual environment at `~/.venvs/kggen`
   - Install all required dependencies with pinned versions
   - Set up everything needed for KGGen to run

2. When prompted, provide the path to the KGGen repository if you have it:
   - If you don't have the KGGen repository, just press Enter
   - You will need to install KGGen separately

3. Set the environment variables as displayed by the script:
   ```bash
   export KGGEN_BIN="/Users/yourusername/.venvs/kggen/bin/python"
   export KGGEN_SCRIPT="/path/to/project/scripts/kg_gen_cli.py"
   export KGGEN_MODE=real
   ```

4. If needed, you can install KGGen manually in the activated environment:
   ```bash
   source ~/.venvs/kggen/bin/activate
   pip install kg-gen==0.1.7  # Or other compatible version
   ```

### Manual Installation (Alternative)

If you prefer to set up KGGen manually:

1. Ensure Python ≥ 3.9 is installed on your system:
   ```bash
   python3 --version
   ```

2. Create a Python virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. Install KGGen and its dependencies:
   ```bash
   pip install kg-gen==0.1.7
   ```

4. Verify the installation:
   ```bash
   python -m kg_gen --help
   ```

### Configuration

Set the following environment variables in your `.env` file:

```
# KGGen execution mode: mock | real | module
KGGEN_MODE=real

# Optional: absolute path to kg_gen if not on PATH
KGGEN_BIN=/usr/local/bin/kg_gen

# LLM model to use
KGGEN_MODEL=openai/gpt-4

# Timeout for KGGen process (in milliseconds)
KGGEN_TIMEOUT=120000

# OpenAI API key for LLM access
OPENAI_API_KEY=sk-your-openai-key-here

# Graph Store Configuration
# Number of merges after which compaction is triggered (default: 500)
COMPACT_THRESHOLD=500

# File size in MB that triggers compaction (default: 20)
COMPACT_MB_LIMIT=20

# Maximum file size in MB before health check reports critical status (default: 100)
MAX_GRAPH_MB=100

# Enable fsync for durability at cost of performance (default: false)
FSYNC=false

# Graph file and metadata paths
GLOBAL_GRAPH_PATH=/data/skb/global_graph.json
ALIAS_MAP_PATH=/data/skb/alias_map.yml
FRAGMENT_DIR=/data/skb/graph_fragments
```

### Execution Modes

- **mock** (default in CI): Uses a stub generator that creates simple mock fragments without LLM calls. Fast, deterministic, and free.
- **real**: Calls the KGGen CLI directly (must be on PATH or configured via `KGGEN_BIN`).
- **module**: Uses Python's module mode (`python -m kg_gen`) for execution.

### Metrics

When using the real KGGen extractor, the following additional metrics are tracked:

- `skb_kggen_execution_time_ms`: Histogram of KGGen CLI execution time
- `skb_kggen_failures_total`: Counter for failed KGGen executions

### Repository Cleanup

To clean up internal virtual environments and reduce repository size:

```bash
./scripts/cleanup-repo.sh
```

This script:
- Removes the internal `venv-kggen` directory
- Cleans up temporary test files and artifacts
- Significantly reduces repository size
- Prevents virtual environment files from being committed

After running this cleanup, you should use the external environment setup described above.

### Docker Setup

When using Docker, the KGGen CLI is installed during the build stage:

```dockerfile
RUN apk add --no-cache python3 py3-pip \
  && pip install --no-cache-dir kg-gen==0.1.7
```

## License

ISC