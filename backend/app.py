# =============================================================================
# कथा मित्र (Katha Mitra) — Flask API Server (app.py)
# =============================================================================
# This is the main entry point for the Katha Mitra backend server.
#
# Responsibilities:
#   1. Serve the frontend static files (HTML/CSS/JS) from '../frontend'
#   2. Provide REST API endpoints for:
#      - Fetching the 9 Navarasa emotions
#      - Fetching random stories by emotion (with exclusion support)
#      - Validating user answers with fuzzy matching
#      - Validating character name input for reflection
#   3. Handle CORS for local development
#   4. Ensure proper UTF-8 encoding for Hindi (Devanagari) text
#
# Run with:  python app.py
# Server:    http://localhost:5000
# =============================================================================

import os
import json
import sqlite3
from flask import Flask, request, jsonify, send_from_directory, render_template_string

# ---------------------------------------------------------------------------
# Import local modules for database access and fuzzy matching
# Works both when run as a script locally and when imported as a package
# by Vercel.
# ---------------------------------------------------------------------------
try:
    from . import db, matcher
except ImportError:
    import db
    import matcher

# ===========================================================================
# SECTION 1: Flask App Configuration
# ===========================================================================

# Resolve the absolute path to the frontend directory
# The frontend is expected to be one level up from backend, in '../frontend'
FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend")
)
ENV_FILE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", ".env")
)


def load_local_env():
    if not os.path.exists(ENV_FILE):
        return

    with open(ENV_FILE, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_local_env()

ANALYTICS_DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Katha Mitra Analytics</title>
    <style>
        body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: #0d0221;
            color: #fff8e7;
        }
        .wrap {
            max-width: 1180px;
            margin: 0 auto;
            padding: 24px;
        }
        h1, h2 {
            margin: 0 0 16px;
        }
        .sub {
            color: rgba(255, 248, 231, 0.75);
            margin-bottom: 24px;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
            margin-bottom: 28px;
        }
        .card {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 18px;
        }
        .label {
            font-size: 13px;
            color: rgba(255, 248, 231, 0.72);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }
        .value {
            font-size: 30px;
            font-weight: 700;
            color: #ffd700;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background: rgba(255, 255, 255, 0.04);
            border-radius: 14px;
            overflow: hidden;
        }
        th, td {
            padding: 12px 10px;
            text-align: left;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            vertical-align: top;
            font-size: 14px;
        }
        th {
            color: #ffd700;
            background: rgba(255, 255, 255, 0.03);
        }
        .pill {
            display: inline-block;
            background: rgba(255, 153, 51, 0.18);
            color: #ffcf99;
            border-radius: 999px;
            padding: 4px 10px;
            font-size: 12px;
            white-space: nowrap;
        }
        .section {
            margin-top: 28px;
        }
        pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
            color: rgba(255, 248, 231, 0.85);
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="wrap">
        <h1>Katha Mitra Analytics</h1>
        <div class="sub">{{ storage_note }}</div>

        <div class="grid">
            <div class="card"><div class="label">Total Events</div><div class="value">{{ summary.total_events }}</div></div>
            <div class="card"><div class="label">Sessions</div><div class="value">{{ summary.total_sessions }}</div></div>
            <div class="card"><div class="label">Anonymous Users</div><div class="value">{{ summary.total_users }}</div></div>
            <div class="card"><div class="label">Stories Finished</div><div class="value">{{ summary.stories_finished }}</div></div>
            <div class="card"><div class="label">Completed Sessions</div><div class="value">{{ summary.completed_sessions }}</div></div>
            <div class="card"><div class="label">Avg Session Seconds</div><div class="value">{{ summary.avg_session_duration }}</div></div>
        </div>

        <div class="section">
            <h2>Event Counts</h2>
            <table>
                <thead>
                    <tr><th>Event</th><th>Count</th></tr>
                </thead>
                <tbody>
                    {% for row in event_counts %}
                    <tr>
                        <td><span class="pill">{{ row.event_name }}</span></td>
                        <td>{{ row.count }}</td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>Recent Events</h2>
            <table>
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Event</th>
                        <th>Session</th>
                        <th>Screen</th>
                        <th>Story</th>
                        <th>Duration</th>
                        <th>Metadata</th>
                    </tr>
                </thead>
                <tbody>
                    {% for event in recent_events %}
                    <tr>
                        <td>{{ event.created_at }}</td>
                        <td><span class="pill">{{ event.event_name }}</span></td>
                        <td>{{ event.session_id }}</td>
                        <td>{{ event.screen or "" }}</td>
                        <td>{{ event.story_id or "" }}</td>
                        <td>{{ event.duration_seconds or "" }}</td>
                        <td><pre>{{ event.metadata | tojson(indent=2) }}</pre></td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>
"""

# Create the Flask app with the frontend directory as the static folder
# Setting static_folder to the frontend dir allows Flask to serve HTML/CSS/JS
# Setting static_url_path to '' means static files are served from root '/'
app = Flask(
    __name__,
    static_folder=FRONTEND_DIR,
    static_url_path=""
)


# ===========================================================================
# SECTION 2: UTF-8 JSON Configuration
# ===========================================================================
# By default, Flask's jsonify uses ensure_ascii=True, which escapes all
# non-ASCII characters (like Hindi/Devanagari) into \uXXXX sequences.
# This makes the JSON unreadable for debugging and increases payload size.
# Setting JSON_AS_ASCII to False preserves the original Unicode characters.
# ===========================================================================
app.config["JSON_AS_ASCII"] = False

IS_VERCEL = bool(os.getenv("VERCEL"))

# Initialize the writable local database, but avoid crashing on Vercel's
# read-only deployment filesystem.
try:
    if not IS_VERCEL:
        db.init_db()
except sqlite3.OperationalError as error:
    print(f"Database initialization skipped: {error}", flush=True)


# ===========================================================================
# SECTION 3: CORS Headers for Development
# ===========================================================================
# During development, the frontend might be served from a different port
# (e.g., live-server on :8080) while the API runs on :5000.
# This after_request hook adds CORS headers to all responses.
# ===========================================================================

@app.after_request
def add_cors_headers(response):
    """
    Add Cross-Origin Resource Sharing (CORS) headers to every response.

    This allows the frontend to make API requests from a different origin
    during development. In production, you may want to restrict the
    Access-Control-Allow-Origin to your specific domain.

    Args:
        response: The Flask response object to modify

    Returns:
        The modified response with CORS headers added
    """
    # Allow requests from any origin (use specific domain in production)
    response.headers["Access-Control-Allow-Origin"] = "*"
    # Allow common HTTP methods used by the API
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    # Allow Content-Type header (needed for JSON POST requests)
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


# ===========================================================================
# SECTION 4: Static File Serving — Frontend
# ===========================================================================

@app.route("/")
def serve_index():
    """
    Serve the main index.html file from the frontend directory.

    This is the entry point for the single-page application (SPA).
    All frontend routing is handled client-side by JavaScript.

    Returns:
        The index.html file from the frontend directory
    """
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>")
def serve_static(filename):
    """
    Serve any static file from the frontend directory.

    This catch-all route handles requests for CSS, JS, images, fonts,
    and any other static assets the frontend needs.

    Args:
        filename (str): The relative path to the requested file

    Returns:
        The requested file from the frontend directory, or 404 if not found
    """
    return send_from_directory(FRONTEND_DIR, filename)


@app.route("/analytics-dashboard")
def analytics_dashboard():
    storage_mode = db.analytics_storage_mode()

    if IS_VERCEL and storage_mode != "supabase":
        return render_template_string(
            """
            <html>
            <head><title>Katha Mitra Analytics</title></head>
            <body style="font-family: Arial, sans-serif; background:#0d0221; color:#fff8e7; padding:32px;">
                <h1>Katha Mitra Analytics</h1>
                <p>The local SQLite dashboard is available only in local development.</p>
                <p>On Vercel, analytics events are written to runtime logs instead of a shared SQLite database.</p>
                <p>Please open Vercel runtime logs and search for <strong>ANALYTICS</strong>.</p>
            </body>
            </html>
            """
        )

    try:
        summary = db.get_analytics_summary()
        event_counts = db.get_event_counts_by_name()
        recent_events = db.get_recent_analytics_events(limit=200)
    except Exception as error:
        if IS_VERCEL:
            return render_template_string(
                """
                <html>
                <head><title>Katha Mitra Analytics</title></head>
                <body style="font-family: Arial, sans-serif; background:#0d0221; color:#fff8e7; padding:32px;">
                    <h1>Katha Mitra Analytics</h1>
                    <p>Analytics dashboard is not available right now.</p>
                    <p>Error: {{ error_message }}</p>
                </body>
                </html>
                """,
                error_message=str(error),
            ), 500
        raise
    if storage_mode == "supabase":
        storage_note = "This dashboard reads from your Supabase analytics table and is suitable for deployed user traffic."
    else:
        storage_note = "This dashboard reads from the local SQLite analytics table. On Vercel, serverless storage is ephemeral, so use runtime logs or Supabase for durable production inspection."
    return render_template_string(
        ANALYTICS_DASHBOARD_HTML,
        summary=summary,
        event_counts=event_counts,
        recent_events=recent_events,
        storage_note=storage_note,
    )


# ===========================================================================
# SECTION 5: API Endpoint — Get Emotions (GET /api/emotions)
# ===========================================================================

@app.route("/api/emotions", methods=["GET"])
def api_get_emotions():
    """
    Return the list of 9 Navarasa emotions with their emoji and Hindi labels.

    Response format:
        {
            "emotions": [
                {"id": 1, "rasa": "शृंगार", "emoji": "💕", "label_hindi": "प्रेम (शृंगार)"},
                ...
            ]
        }

    Returns:
        JSON response with the complete list of 9 emotions
    """
    emotions = db.get_emotions()

    # Return the emotions list wrapped in an object for extensibility
    return jsonify({"emotions": emotions})


# ===========================================================================
# SECTION 6: API Endpoint — Get Story (GET /api/story)
# ===========================================================================

@app.route("/api/story", methods=["GET"])
def api_get_story():
    """
    Return a random story matching the requested rasa (emotion).

    Query Parameters:
        rasa (str, required): The emotion/rasa to filter by (e.g., "वीर")
        exclude (str, optional): Comma-separated list of story IDs to
            exclude (e.g., "1,5,12"). Used to avoid repeating stories
            the user has already heard in the current session.

    Response format (success):
        {
            "story": {
                "id": 42,
                "title": "...",
                "source": "...",
                "rasa": "वीर",
                "story_text": "...",
                "characters": ["अर्जुन", "कृष्ण"],
                "recall_question": "...",
                "correct_answer": "...",
                "hint": "...",
                "reflection_question": "..."
            }
        }

    Response format (error — no stories available):
        {"error": "इस रस के लिए कोई कहानी उपलब्ध नहीं है।"}, 404

    Returns:
        JSON response with a random story or an error message
    """
    # -----------------------------------------------------------------------
    # Parse the 'rasa' query parameter (required)
    # -----------------------------------------------------------------------
    rasa = request.args.get("rasa")
    if not rasa:
        return jsonify({"error": "rasa parameter is required"}), 400

    # -----------------------------------------------------------------------
    # Parse the 'exclude' query parameter (optional, comma-separated IDs)
    # -----------------------------------------------------------------------
    exclude_param = request.args.get("exclude", "")
    exclude_ids = []

    if exclude_param:
        try:
            # Split by comma and convert each to integer
            # Filter out empty strings that might result from trailing commas
            exclude_ids = [
                int(id_str.strip())
                for id_str in exclude_param.split(",")
                if id_str.strip()
            ]
        except ValueError:
            # If parsing fails, ignore the exclude parameter and continue
            # This is lenient — we don't want to fail just because of
            # a malformed exclude parameter
            exclude_ids = []

    # -----------------------------------------------------------------------
    # Fetch a random story from the database
    # -----------------------------------------------------------------------
    story = db.get_story(rasa, exclude_ids)

    if story is None:
        # No stories available for this rasa (all excluded or none exist)
        return jsonify({
            "error": "इस रस के लिए कोई कहानी उपलब्ध नहीं है।"
        }), 404

    # -----------------------------------------------------------------------
    # Parse JSON string fields into proper Python lists for the response
    # The database stores characters and answer_keywords as JSON strings
    # -----------------------------------------------------------------------
    try:
        story["characters"] = json.loads(story["characters"])
    except (json.JSONDecodeError, TypeError):
        # Fallback: if JSON parsing fails, wrap as single-element list
        story["characters"] = [story["characters"]]

    try:
        story["answer_keywords"] = json.loads(story["answer_keywords"])
    except (json.JSONDecodeError, TypeError):
        story["answer_keywords"] = [story["answer_keywords"]]

    # -----------------------------------------------------------------------
    # Build the response — exclude answer_keywords from the response
    # to prevent the client from seeing the expected answers
    # -----------------------------------------------------------------------
    response_story = {
        "id": story["id"],
        "title": story["title"],
        "source": story["source"],
        "rasa": story["rasa"],
        "story_text": story["story_text"],
        "characters": story["characters"],
        "recall_question": story["recall_question"],
        "correct_answer": story["correct_answer"],
        "hint": story["hint"],
        "reflection_question": story["reflection_question"],
    }

    return jsonify({"story": response_story})


# ===========================================================================
# SECTION 7: API Endpoint — Validate Answer (POST /api/validate-answer)
# ===========================================================================

@app.route("/api/validate-answer", methods=["POST"])
def api_validate_answer():
    """
    Validate the user's answer to the story's recall question.

    Uses fuzzy string matching to compare the user's Hindi answer against
    the story's answer keywords. Supports two attempts:
        - Attempt 1: Returns hint if wrong
        - Attempt 2+: Returns the correct answer if wrong

    Request body (JSON):
        {
            "story_id": 42,
            "user_answer": "अर्जुन ने गांडीव उठाया",
            "attempt": 1
        }

    Response format (correct):
        {"correct": true}

    Response format (wrong, attempt 1):
        {"correct": false, "hint": "सोचिए, किसने धनुष उठाया..."}

    Response format (wrong, attempt 2+):
        {"correct": false, "answer": "अर्जुन ने गांडीव धनुष उठाया"}

    Returns:
        JSON response indicating correctness with optional hint or answer
    """
    # -----------------------------------------------------------------------
    # Parse and validate the request body
    # -----------------------------------------------------------------------
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    story_id = data.get("story_id")
    user_answer = data.get("user_answer", "")
    attempt = data.get("attempt", 1)

    # Validate required fields
    if story_id is None:
        return jsonify({"error": "story_id is required"}), 400
    if not user_answer.strip():
        return jsonify({"error": "user_answer is required"}), 400

    # -----------------------------------------------------------------------
    # Fetch the story to get answer keywords
    # -----------------------------------------------------------------------
    story = db.get_story_by_id(story_id)

    if story is None:
        return jsonify({"error": "Story not found"}), 404

    # Parse the answer_keywords from JSON string to list
    try:
        answer_keywords = json.loads(story["answer_keywords"])
    except (json.JSONDecodeError, TypeError):
        answer_keywords = [story["answer_keywords"]]

    # -----------------------------------------------------------------------
    # Perform fuzzy matching against answer keywords
    # -----------------------------------------------------------------------
    is_correct = matcher.match_answer(user_answer, answer_keywords)

    if is_correct:
        # User got it right — simple success response
        return jsonify({"correct": True})
    else:
        # User got it wrong — response depends on attempt number
        if attempt <= 1:
            # First wrong attempt: provide a hint to guide the user
            return jsonify({
                "correct": False,
                "hint": story["hint"]
            })
        else:
            # Second (or later) wrong attempt: reveal the correct answer
            return jsonify({
                "correct": False,
                "answer": story["correct_answer"]
            })


# ===========================================================================
# SECTION 8: API Endpoint — Validate Character (POST /api/validate-character)
# ===========================================================================

@app.route("/api/validate-character", methods=["POST"])
def api_validate_character():
    """
    Validate that a user-spoken character name matches a character from the story.

    Uses fuzzy matching to find the closest matching character name from
    the story's character list. This handles pronunciation/spelling
    variations in voice-to-text input.

    Request body (JSON):
        {
            "story_id": 42,
            "character_name": "अर्जुन"
        }

    Response format (valid match):
        {
            "valid": true,
            "matched_character": "अर्जुन",
            "characters": ["अर्जुन", "कृष्ण", "दुर्योधन"]
        }

    Response format (no match):
        {
            "valid": false,
            "matched_character": null,
            "characters": ["अर्जुन", "कृष्ण", "दुर्योधन"]
        }

    Returns:
        JSON response with match result and full character list
    """
    # -----------------------------------------------------------------------
    # Parse and validate the request body
    # -----------------------------------------------------------------------
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    story_id = data.get("story_id")
    character_name = data.get("character_name", "")

    # Validate required fields
    if story_id is None:
        return jsonify({"error": "story_id is required"}), 400
    if not character_name.strip():
        return jsonify({"error": "character_name is required"}), 400

    # -----------------------------------------------------------------------
    # Fetch the story to get the character list
    # -----------------------------------------------------------------------
    story = db.get_story_by_id(story_id)

    if story is None:
        return jsonify({"error": "Story not found"}), 404

    # Parse characters from JSON string to list
    try:
        characters = json.loads(story["characters"])
    except (json.JSONDecodeError, TypeError):
        characters = [story["characters"]]

    # -----------------------------------------------------------------------
    # Perform fuzzy matching against the character list
    # -----------------------------------------------------------------------
    matched = matcher.match_character(character_name, characters)

    return jsonify({
        "valid": matched is not None,
        "matched_character": matched,
        "characters": characters,
    })


# ===========================================================================
# SECTION 9: API Endpoint - Anonymous Analytics (POST /api/analytics)
# ===========================================================================

@app.route("/api/analytics", methods=["POST"])
def api_analytics():
    """
    Record anonymous client-side analytics events.

    The endpoint intentionally does not store personally identifying data.
    Events are written to stdout as JSON so they can be viewed in local logs
    and Vercel runtime logs.
    """
    data = request.get_json(silent=True) or {}

    event_name = data.get("event_name")
    session_id = data.get("session_id")

    if not event_name or not session_id:
        return jsonify({"error": "event_name and session_id are required"}), 400

    payload = {
        "event_name": event_name,
        "session_id": session_id,
        "anonymous_user_id": data.get("anonymous_user_id"),
        "screen": data.get("screen"),
        "story_id": data.get("story_id"),
        "duration_seconds": data.get("duration_seconds"),
        "metadata": data.get("metadata", {}),
        "user_agent": request.headers.get("User-Agent"),
        "timestamp": data.get("timestamp"),
    }

    try:
        if not IS_VERCEL or db.analytics_storage_mode() == "supabase":
            db.insert_analytics_event(payload)
    except Exception as error:
        print(f"ANALYTICS_WRITE_FAILED {error}", flush=True)
    print(f"ANALYTICS {json.dumps(payload, ensure_ascii=False)}", flush=True)
    return jsonify({"ok": True})


# ===========================================================================
# SECTION 10: Application Entry Point
# ===========================================================================

if __name__ == "__main__":
    # -----------------------------------------------------------------------
    # Initialize the database on startup
    # This creates tables if they don't exist and seeds the 9 Navarasa
    # -----------------------------------------------------------------------
    print("=" * 60)
    print("  Katha Mitra - Starting Server...")
    print("=" * 60)

    db.init_db()
    print("Database initialized successfully")
    print(f"Frontend directory: {FRONTEND_DIR}")
    print("Server running at: http://localhost:5000")
    print("=" * 60)

    # -----------------------------------------------------------------------
    # Run the Flask development server
    # - host="0.0.0.0": Accept connections from any network interface
    # - port=5000: Standard Flask development port
    # - debug=True: Enable auto-reload and detailed error pages
    # -----------------------------------------------------------------------
    app.run(host="0.0.0.0", port=5000, debug=True)
