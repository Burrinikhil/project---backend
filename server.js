const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const path = require('path');
const crypto = require('crypto');

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

// simple hash (demo only)
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

// Root route
app.get('/', (req, res) => {
  res.send('Smart Expense Splitter API (SQLite) is running');
});

//
// === Auth API ===
// POST /api/auth/register
//
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: 'Name, email, and password are required' });
  }

  const sql = 'INSERT INTO users (name, email, password) VALUES (?, ?, ?)';
  db.run(
    sql,
    [name.trim(), email.trim(), hashPassword(password)],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ message: 'Email already registered' });
        }
        console.error('Error registering user:', err.message);
        return res.status(500).json({ message: 'Failed to register' });
      }

      res.status(201).json({
        user: { id: this.lastID, name: name.trim(), email: email.trim() },
        token: `dummy-token-${this.lastID}`,
      });
    }
  );
});

//
// POST /api/auth/login
//
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: 'Email and password are required' });
  }

  const sql =
    'SELECT id, name, email, password FROM users WHERE email = ?';
  db.get(sql, [email.trim()], (err, row) => {
    if (err) {
      console.error('Error fetching user:', err.message);
      return res.status(500).json({ message: 'Failed to login' });
    }
    if (!row || row.password !== hashPassword(password)) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    res.json({
      user: { id: row.id, name: row.name, email: row.email },
      token: `dummy-token-${row.id}`,
    });
  });
});

//
// === Groups API ===
// GET /api/groups
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
// GET /api/groups/:id
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
// POST /api/groups
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
