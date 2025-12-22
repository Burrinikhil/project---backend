const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// SQLite DB file
const dbPath = path.join(__dirname, 'smart_expense.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at', dbPath);
  }
});

// Root route for health check
app.get('/', (req, res) => {
  res.send('Smart Expense Splitter API (SQLite) is running');
});

//
// === Groups API ===
// GET /api/groups - list all groups
//
app.get('/api/groups', (req, res) => {
  const sql = 'SELECT id, name, type FROM groups ORDER BY id DESC';
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching groups:', err.message);
      return res.status(500).json({ message: 'Failed to load groups' });
    }
    res.json(rows);
  });
});

//
// GET /api/groups/:id - single group
//
app.get('/api/groups/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: 'Invalid group id' });
  }

  const sql = 'SELECT id, name, type FROM groups WHERE id = ?';
  db.get(sql, [id], (err, row) => {
    if (err) {
      console.error('Error fetching group:', err.message);
      return res.status(500).json({ message: 'Failed to load group' });
    }
    if (!row) {
      return res.status(404).json({ message: 'Group not found' });
    }
    res.json(row);
  });
});

//
// POST /api/groups - create new group
//
app.post('/api/groups', (req, res) => {
  const { name, type } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Group name is required' });
  }

  const sql = 'INSERT INTO groups (name, type) VALUES (?, ?)';
  db.run(sql, [name.trim(), type || 'other'], function (err) {
    if (err) {
      console.error('Error creating group:', err.message);
      return res.status(500).json({ message: 'Failed to create group' });
    }

    res.status(201).json({
      id: this.lastID,
      name: name.trim(),
      type: type || 'other',
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
