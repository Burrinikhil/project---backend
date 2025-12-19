const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

// open SQLite database
const dbPath = path.join(__dirname, 'smart_expense.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at', dbPath);
  }
});

// ROOT route – this is what frontend reads
app.get('/', (req, res) => {
  res.send('Smart Expense Splitter API (SQLite) is running');
});

// example auth routes (keep whatever you already had)
app.post('/api/auth/register', (req, res) => {
  // your existing register code here
  res.json({ message: 'Register endpoint placeholder' });
});

app.post('/api/auth/login', (req, res) => {
  // your existing login code here
  res.json({ message: 'Login endpoint placeholder' });
});

// start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
