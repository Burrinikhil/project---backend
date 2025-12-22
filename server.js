const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// adjust file name if your DB is different
const dbPath = path.join(__dirname, 'smart_expense.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at', dbPath);
  }
});

// root route for frontend test
app.get('/', (req, res) => {
  res.send('Smart Expense Splitter API (SQLite) is running');
});

// TODO: keep/add your other API routes here

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
