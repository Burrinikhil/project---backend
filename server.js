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

/* ========== AUTH ========== */

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

/* ========== GROUPS ========== */

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

/* ========== EXPENSES BY GROUP ========== */

app.get('/api/groups/:id/expenses', (req, res) => {
  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId)) {
    return res.status(400).json({ message: 'Invalid group id' });
  }

  const sql =
    'SELECT id, description, amount, category, date ' +
    'FROM expenses WHERE group_id = ? ORDER BY date DESC';

  db.all(sql, [groupId], (err, rows) => {
    if (err) {
      console.error('Error fetching expenses:', err.message);
      return res.status(500).json({ message: 'Failed to load expenses' });
    }
    res.json(rows);
  });
});

app.post('/api/groups/:id/expenses', (req, res) => {
  const groupId = Number(req.params.id);
  const { description, amount, category, paidBy } = req.body;

  if (!Number.isInteger(groupId)) {
    return res.status(400).json({ message: 'Invalid group id' });
  }
  if (!description || !description.trim() || !amount) {
    return res
      .status(400)
      .json({ message: 'Description and amount are required' });
  }
  if (!paidBy) {
    return res.status(400).json({ message: 'paidBy (user id) is required' });
  }

  const now = new Date().toISOString();

  const sql =
    'INSERT INTO expenses (group_id, paid_by, description, amount, category, date, split_type) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?)';

  db.run(
    sql,
    [
      groupId,
      paidBy,
      description.trim(),
      Number(amount),
      category || 'other',
      now,
      'equal',
    ],
    function (err) {
      if (err) {
        console.error('Error creating expense:', err.message);
        return res.status(500).json({ message: 'Failed to create expense' });
      }

      res.status(201).json({
        id: this.lastID,
        group_id: groupId,
        paid_by: paidBy,
        description: description.trim(),
        amount: Number(amount),
        category: category || 'other',
        date: now,
        split_type: 'equal',
      });
    }
  );
});
// GET /api/groups/:id/balances  -> smart split balances for this group
app.get('/api/groups/:id/balances', (req, res) => {
  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId)) {
    return res.status(400).json({ message: 'Invalid group id' });
  }

  // join expenses with users who paid
  const sql = `
    SELECT e.id,
           e.amount,
           e.paid_by,
           u.name AS payer_name
    FROM expenses e
    JOIN users u ON e.paid_by = u.id
    WHERE e.group_id = ?
  `;

  db.all(sql, [groupId], (err, rows) => {
    if (err) {
      console.error('Error fetching expenses for balances:', err.message);
      return res.status(500).json({ message: 'Failed to compute balances' });
    }
    if (rows.length === 0) {
      return res.json({ balances: [], settlements: [] });
    }

    // For now, assume all payers in this group share equally
    const memberIds = [...new Set(rows.map(r => r.paid_by))];
    const paidTotals = {};
    const names = {};

    memberIds.forEach(id => {
      paidTotals[id] = 0;
    });

    rows.forEach(r => {
      paidTotals[r.paid_by] += r.amount;
      names[r.paid_by] = r.payer_name;
    });

    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    const equalShare = total / memberIds.length;

    const balances = memberIds.map(id => ({
      userId: id,
      name: names[id],
      paid: paidTotals[id],
      share: equalShare,
      net: +(paidTotals[id] - equalShare).toFixed(2),
    }));

    // build settlements (simple greedy)
    const creditors = balances
      .filter(b => b.net > 0)
      .sort((a, b) => b.net - a.net);
    const debtors = balances
      .filter(b => b.net < 0)
      .sort((a, b) => a.net - b.net);

    const settlements = [];
    let i = 0, j = 0;

    while (i < debtors.length && j < creditors.length) {
      const d = debtors[i];
      const c = creditors[j];
      const amount = Math.min(-d.net, c.net);

      settlements.push({
        fromId: d.userId,
        from: d.name,
        toId: c.userId,
        to: c.name,
        amount: +amount.toFixed(2),
      });

      d.net += amount;
      c.net -= amount;

      if (Math.abs(d.net) < 0.01) i++;
      if (Math.abs(c.net) < 0.01) j++;
    }

    res.json({ balances, settlements });
  });
});

// DELETE /api/groups/:id  -> delete a group and its expenses
// placed near other group routes
app.delete('/api/groups/:groupId/expenses/:expenseId', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: 'Invalid group id' });
  }

  const deleteExpensesSql = 'DELETE FROM expenses WHERE group_id = ?';
  db.run(deleteExpensesSql, [id], function (err) {
    if (err) {
      console.error('Error deleting group expenses:', err.message);
      return res.status(500).json({ message: 'Failed to delete group expenses' });
    }

    const deleteGroupSql = 'DELETE FROM groups WHERE id = ?';
    db.run(deleteGroupSql, [id], function (err2) {
      if (err2) {
        console.error('Error deleting group:', err2.message);
        return res.status(500).json({ message: 'Failed to delete group' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Group not found' });
      }
      res.json({ success: true });
    });
  });
});

/* ========== DASHBOARD: RECENT + ACTIVITY ========== */

// Last 5 expenses across all groups
app.get('/api/recent-expenses', (req, res) => {
  const sql = `
    SELECT e.id,
           e.description,
           e.amount,
           e.date,
           e.category,
           g.id   AS group_id,
           g.name AS group_name
    FROM expenses e
    JOIN groups g ON e.group_id = g.id
    ORDER BY e.date DESC
    LIMIT 5
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching recent expenses:', err.message);
      return res.status(500).json({ message: 'Failed to load recent expenses' });
    }
    res.json(rows);
  });
});

// Simple activity feed: one item per expense
app.get('/api/activity', (req, res) => {
  const sql = `
    SELECT e.id,
           e.description,
           e.amount,
           e.date,
           g.id   AS group_id,
           g.name AS group_name
    FROM expenses e
    JOIN groups g ON e.group_id = g.id
    ORDER BY e.date DESC
    LIMIT 5
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching activity:', err.message);
      return res.status(500).json({ message: 'Failed to load activity' });
    }
    const activity = rows.map((r) => ({
      id: r.id,
      text: `${r.description} in ${r.group_name}`,
      amount: r.amount,
      date: r.date,
      groupId: r.group_id,
    }));
    res.json(activity);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
