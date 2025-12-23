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

// POST /api/groups/:id/expenses  (smart split)
app.post('/api/groups/:id/expenses', (req, res) => {
  const groupId = Number(req.params.id);
  const { description, amount, category, splits } = req.body;

  if (!Number.isInteger(groupId)) {
    return res.status(400).json({ message: 'Invalid group id' });
  }
  if (!description || !description.trim() || !amount) {
    return res
      .status(400)
      .json({ message: 'Description and amount are required' });
  }

  if (!Array.isArray(splits) || splits.length === 0) {
    return res
      .status(400)
      .json({ message: 'At least one participant required' });
  }

  const totalAmount = Number(amount);
  let computedSplits = splits.map((s) => ({ ...s }));
  const mode = splits[0].mode || 'equal';

  if (mode === 'equal') {
    const share = totalAmount / splits.length;
    computedSplits = splits.map((s) => ({
      ...s,
      mode: 'equal',
      amount: share,
      percent: null,
    }));
  } else if (mode === 'percent') {
    const sumPercent = splits.reduce(
      (sum, s) => sum + Number(s.percent || 0),
      0
    );
    if (Math.round(sumPercent) !== 100) {
      return res
        .status(400)
        .json({ message: 'Percent splits must sum to 100' });
    }
    computedSplits = splits.map((s) => ({
      ...s,
      mode: 'percent',
      amount: (totalAmount * Number(s.percent)) / 100,
    }));
  } else if (mode === 'custom') {
    const sumAmount = splits.reduce(
      (sum, s) => sum + Number(s.amount || 0),
      0
    );
    if (Math.round(sumAmount * 100) !== Math.round(totalAmount * 100)) {
      return res
        .status(400)
        .json({ message: 'Custom amounts must sum to total amount' });
    }
  } else {
    return res.status(400).json({ message: 'Invalid split mode' });
  }

  const insertExpenseSql =
    'INSERT INTO expenses (group_id, description, amount, category) VALUES (?, ?, ?, ?)';

  db.run(
    insertExpenseSql,
    [groupId, description.trim(), totalAmount, category || 'other'],
    function (err) {
      if (err) {
        console.error('Error creating expense:', err.message);
        return res.status(500).json({ message: 'Failed to create expense' });
      }

      const expenseId = this.lastID;

      const insertSplitSql =
        'INSERT INTO expense_splits (expense_id, member_name, mode, percent, amount) ' +
        'VALUES (?, ?, ?, ?, ?)';

      const stmt = db.prepare(insertSplitSql);
      for (const s of computedSplits) {
        stmt.run([
          expenseId,
          s.member_name,
          s.mode,
          s.percent != null ? Number(s.percent) : null,
          Number(s.amount),
        ]);
      }
      stmt.finalize((splitErr) => {
        if (splitErr) {
          console.error('Error inserting splits:', splitErr.message);
          return res
            .status(500)
            .json({ message: 'Failed to save splits' });
        }

        res.status(201).json({
          id: expenseId,
          group_id: groupId,
          description: description.trim(),
          amount: totalAmount,
          category: category || 'other',
          splits: computedSplits,
        });
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
// placed near other group rout
 app.delete('/api/groups/:groupId/expenses/:expenseId', (req, res) => {
  const groupId = parseInt(req.params.groupId, 10);
  const expenseId = parseInt(req.params.expenseId, 10);

  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(400).json({ message: 'Invalid groupId' });
  }
  if (!Number.isInteger(expenseId) || expenseId <= 0) {
    return res.status(400).json({ message: 'Invalid expenseId' });
  }

  const verifySql = 'SELECT id FROM expenses WHERE id = ? AND group_id = ?';
  db.get(verifySql, [expenseId, groupId], (err, row) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!row) return res.status(404).json({ message: 'Expense not found' });

    const deleteSql = 'DELETE FROM expenses WHERE id = ?';
    db.run(deleteSql, [expenseId], function (err) {
      if (err) return res.status(500).json({ message: 'Failed to delete expense' });
      return res.json({ success: true, deletedId: expenseId });
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
