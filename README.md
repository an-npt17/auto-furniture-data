# 3D Object ETL System

FastAPI-based ETL (Extract, Transform, Load) system for processing 3D objects with Cloudflare R2 storage and PostgreSQL database.

## Features

- **Upload 3D Models**: RESTful API for uploading GLB files
- **Automatic Processing**: Generate multiple variants of 3D models
  - Small variant (low poly ~5K faces)
  - Normal variant (medium poly ~50K faces)
  - Big variant (high poly ~200K faces)
- **Thumbnail Generation**: Automatically create multiple thumbnail sizes
- **Cloud Storage**: Store files in Cloudflare R2 (S3-compatible)
- **Metadata Management**: Track processing status and model metadata in PostgreSQL
- **Type-Safe**: Full type checking with basedpyright in strict mode
- **Async**: Built with asyncio and async database access

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────────┐
│    FastAPI      │  ← REST endpoints
└────────┬────────┘
         │
         ├─────────────────┐
         │                 │
         ▼                 ▼
┌────────────────┐  ┌──────────────┐
│   PostgreSQL   │  │ Cloudflare R2│
│   (Metadata)   │  │   (Files)    │
└────────────────┘  └──────────────┘
```

## Tech Stack

- **FastAPI**: Modern async web framework
- **PostgreSQL**: Relational database for metadata
- **SQLAlchemy 2.0**: Async ORM
- **Alembic**: Database migrations
- **Cloudflare R2**: S3-compatible object storage
- **Trimesh**: 3D model processing
- **Pillow**: Image generation
- **Pydantic**: Data validation and settings
- **basedpyright**: Static type checking

## Project Structure

```
auto-furniture-data/
├── app/
│   ├── api/              # API endpoints
│   │   ├── __init__.py
│   │   └── objects.py    # 3D object endpoints
│   ├── core/             # Core configuration
│   │   ├── __init__.py
│   │   └── config.py     # Pydantic settings
│   ├── db/               # Database setup
│   │   ├── __init__.py
│   │   ├── base.py       # Base model
│   │   └── session.py    # DB session
│   ├── models/           # SQLAlchemy models
│   │   ├── __init__.py
│   │   ├── object_3d.py  # 3D object model
│   │   └── object_file.py# File model
│   ├── schemas/          # Pydantic schemas
│   │   ├── __init__.py
│   │   └── object_schema.py
│   ├── services/         # Business logic
│   │   ├── __init__.py
│   │   ├── storage_service.py    # R2 storage
│   │   ├── model_processor.py   # 3D processing
│   │   ├── thumbnail_service.py # Thumbnails
│   │   └── etl_service.py       # ETL pipeline
│   └── __init__.py
├── alembic/              # Database migrations
│   ├── versions/
│   ├── env.py
│   └── script.py.mako
├── tests/                # Test files
├── main.py               # Application entry point
├── alembic.ini           # Alembic config
├── pyrightconfig.json    # Type checker config
├── pyproject.toml        # Project dependencies
├── .env.example          # Example environment variables
└── README.md             # This file
```

## Setup

### Prerequisites

- Python 3.12
- PostgreSQL database
- Cloudflare R2 account with bucket created

### Installation

1. **Clone and navigate to the project:**
   ```bash
   cd /home/annpt/LLM-Blockchain/auto-furniture-data
   ```

2. **Install dependencies using uv:**
   ```bash
   uv sync
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

4. **Setup database:**
   ```bash
   # Create the database
   createdb furniture_db

   # Run migrations
   uv run alembic upgrade head
   ```

5. **Run the application:**
   ```bash
   uv run python main.py
   ```

   Or for development with auto-reload:
   ```bash
   uv run uvicorn main:app --reload
   ```

## Configuration

All configuration is managed through environment variables or `.env` file:

### Required Settings

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/furniture_db

# Cloudflare R2
R2_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=your-bucket-name
```

### Optional Settings

See `.env.example` for all available configuration options.

## API Usage

### Upload a 3D Object

```bash
curl -X POST "http://localhost:8000/objects/upload" \
  -F "file=@model.glb" \
  -F "name=My 3D Model" \
  -F "description=A beautiful 3D model"
```

Response:
```json
{
  "object_id": "123e4567-e89b-12d3-a456-426614174000",
  "message": "Upload successful. Processing started.",
  "status": "pending"
}
```

### List Objects

```bash
curl "http://localhost:8000/objects?page=1&page_size=20"
```

### Get Object Details

```bash
curl "http://localhost:8000/objects/{object_id}"
```

Response includes all variants and thumbnails:
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "name": "My 3D Model",
  "status": "completed",
  "files": [
    {
      "file_type": "glb_small",
      "storage_path": "objects/.../glb_small.glb",
      "file_size_bytes": 12345
    },
    {
      "file_type": "thumbnail",
      "storage_path": "objects/.../thumbnail_512x512.webp",
      "width": 512,
      "height": 512
    }
  ]
}
```

### Update Object

```bash
curl -X PATCH "http://localhost:8000/objects/{object_id}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Name", "description": "New description"}'
```

### Delete Object

```bash
curl -X DELETE "http://localhost:8000/objects/{object_id}"
```

## API Documentation

Interactive API documentation is available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## ETL Pipeline

The ETL process runs in the background after file upload:

1. **Extract**: Download the original GLB file
2. **Transform**:
   - Parse 3D model and extract metadata
   - Generate 3 variants (small, normal, big) with different polygon counts
   - Render and generate thumbnails in multiple sizes
3. **Load**:
   - Upload all variants to Cloudflare R2
   - Store metadata and file references in PostgreSQL
   - Update processing status

## Database Schema

### objects_3d
- `id` (UUID, PK)
- `name` (String)
- `description` (Text, nullable)
- `original_filename` (String)
- `original_size_bytes` (Integer)
- `status` (Enum: pending, processing, completed, failed)
- `processing_error` (Text, nullable)
- `metadata` (JSON)
- `created_at` (DateTime)
- `updated_at` (DateTime)

### object_files
- `id` (UUID, PK)
- `object_id` (UUID, FK)
- `file_type` (Enum: glb_small, glb_normal, glb_big, thumbnail)
- `storage_path` (String)
- `file_size_bytes` (Integer)
- `content_type` (String)
- `width` (Integer, nullable)
- `height` (Integer, nullable)
- `created_at` (DateTime)
- `updated_at` (DateTime)

## Type Checking

This project uses strict type checking with basedpyright:

```bash
# Run type checker
uv run basedpyright

# Check specific files
uv run basedpyright app/services/
```

## Database Migrations

```bash
# Create a new migration
uv run alembic revision --autogenerate -m "description"

# Apply migrations
uv run alembic upgrade head

# Rollback migration
uv run alembic downgrade -1
```

## Development

```bash
# Run with auto-reload
uv run uvicorn main:app --reload --port 8000

# Run type checker
uv run basedpyright

# Run linter
uv run ruff check .

# Format code
uv run ruff format .
```

## Cloudflare R2 Setup

1. Create a Cloudflare account
2. Navigate to R2 Object Storage
3. Create a new bucket
4. Generate API tokens with read/write permissions
5. Note your account ID from the R2 dashboard
6. Construct endpoint URL: `https://<account_id>.r2.cloudflarestorage.com`

## Production Deployment

1. Set `DEBUG=false` in environment
2. Configure CORS appropriately in `main.py`
3. Use a production ASGI server (uvicorn with workers)
4. Set up reverse proxy (nginx/caddy)
5. Configure database connection pooling
6. Set up monitoring and logging

## License

MIT

## Contributing

Pull requests are welcome! Please ensure type checking passes before submitting.
