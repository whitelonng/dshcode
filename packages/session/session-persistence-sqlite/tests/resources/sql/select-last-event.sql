SELECT seq, type, data
FROM events
WHERE session_id = ?
ORDER BY seq DESC
LIMIT 1;
