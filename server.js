import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// ===== CONFIG =====
const app = express();
const PORT = 3000; // backend port
const JWT_SECRET = "supersecretjwtkey";

// Middleware
app.use(cors());
app.use(express.json());

// Simple root route so browser does not show "Cannot GET /"
app.get("/", (req, res) => {
  res.send("Smart Expense Splitter API (SQLite) is running");
});

// ===== DB CONNECTION =====
const db = new sqlite3.Database("./smart_expense.db", (err) => {
  if (err) {
    console.error("DB connection error:", err.message);
  } else {
    console.log("SQLite DB connected");
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      paid_by INTEGER NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      split_type TEXT NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (paid_by) REFERENCES users(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS expense_shares (
      expense_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
});

// ===== HELPER FUNCTIONS =====
const generateToken = (id) =>
  jwt.sign({ id }, JWT_SECRET, { expiresIn: "1d" });

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token" });
  }
  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

// ===== AUTH ROUTES =====
app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ message: "All fields required" });

  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, row) => {
    if (err) return res.status(500).json({ message: err.message });
    if (row) return res.status(400).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    db.run(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashed],
      function (err2) {
        if (err2) return res.status(500).json({ message: err2.message });
        const token = generateToken(this.lastID);
        res.status(201).json({
          _id: this.lastID,
          name,
          email,
          token
        });
      }
    );
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "All fields required" });

  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err) return res.status(500).json({ message: err.message });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    const token = generateToken(user.id);
    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      token
    });
  });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  db.get(
    "SELECT id, name, email FROM users WHERE id = ?",
    [req.userId],
    (err, user) => {
      if (err) return res.status(500).json({ message: err.message });
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({ _id: user.id, name: user.name, email: user.email });
    }
  );
});

// ===== USER ROUTES =====
app.get("/api/users", authMiddleware, (req, res) => {
  db.all(
    "SELECT id, name, email FROM users ORDER BY name ASC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json(rows);
    }
  );
});

// ===== GROUP ROUTES =====
app.post("/api/groups", authMiddleware, (req, res) => {
  const { name, type, memberIds } = req.body;
  if (!name) return res.status(400).json({ message: "Name required" });

  db.run(
    "INSERT INTO groups (name, type) VALUES (?, ?)",
    [name, type || "other"],
    function (err) {
      if (err) return res.status(500).json({ message: err.message });
      const groupId = this.lastID;

      db.run(
        "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)",
        [groupId, req.userId, "admin"]
      );

      (memberIds || []).forEach((id) => {
        if (id === req.userId) return;
        db.run(
          "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)",
          [groupId, id, "member"]
        );
      });

      res.status(201).json({ id: groupId, name, type: type || "other" });
    }
  );
});

app.get("/api/groups", authMiddleware, (req, res) => {
  db.all(
    `
    SELECT g.id, g.name, g.type
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
  `,
    [req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json(rows);
    }
  );
});

app.get("/api/groups/:id", authMiddleware, (req, res) => {
  const groupId = req.params.id;

  db.get(
    "SELECT id, name, type FROM groups WHERE id = ?",
    [groupId],
    (err, group) => {
      if (err) return res.status(500).json({ message: err.message });
      if (!group) return res.status(404).json({ message: "Group not found" });

      db.get(
        "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?",
        [groupId, req.userId],
        (err2, membership) => {
          if (err2) return res.status(500).json({ message: err2.message });
          if (!membership)
            return res.status(403).json({ message: "Not allowed" });

          db.all(
            `
            SELECT gm.user_id, gm.role, u.name, u.email
            FROM group_members gm
            JOIN users u ON u.id = gm.user_id
            WHERE gm.group_id = ?
          `,
            [groupId],
            (err3, members) => {
              if (err3) return res.status(500).json({ message: err3.message });

              db.all(
                `
                SELECT e.*, u.name AS paid_by_name
                FROM expenses e
                JOIN users u ON u.id = e.paid_by
                WHERE e.group_id = ?
                ORDER BY datetime(e.date) DESC
              `,
                [groupId],
                (err4, expenses) => {
                  if (err4)
                    return res.status(500).json({ message: err4.message });

                  let remaining = expenses.length;
                  if (remaining === 0) {
                    return res.json({
                      group: { ...group, members },
                      expenses: []
                    });
                  }

                  expenses.forEach((e, idx) => {
                    db.all(
                      `
                      SELECT es.user_id, es.amount, u.name
                      FROM expense_shares es
                      JOIN users u ON u.id = es.user_id
                      WHERE es.expense_id = ?
                    `,
                      [e.id],
                      (err5, shares) => {
                        if (err5)
                          return res
                            .status(500)
                            .json({ message: err5.message });
                        expenses[idx].shares = shares;
                        expenses[idx].paidBy = {
                          id: e.paid_by,
                          name: e.paid_by_name
                        };
                        remaining -= 1;
                        if (remaining === 0) {
                          res.json({
                            group: { ...group, members },
                            expenses
                          });
                        }
                      }
                    );
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

// NEW: DELETE group
app.delete("/api/groups/:id", authMiddleware, (req, res) => {
  const groupId = req.params.id;

  db.get(
    "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
    [groupId, req.userId],
    (err, membership) => {
      if (err) return res.status(500).json({ message: err.message });
      if (!membership)
        return res.status(403).json({ message: "Not allowed" });

      db.run(
        "DELETE FROM groups WHERE id = ?",
        [groupId],
        function (err2) {
          if (err2) return res.status(500).json({ message: err2.message });
          if (this.changes === 0) {
            return res.status(404).json({ message: "Group not found" });
          }
          return res.json({ message: "Group deleted" });
        }
      );
    }
  );
});

// ===== EXPENSE ROUTES =====
app.post("/api/expenses", authMiddleware, (req, res) => {
  const { groupId, description, amount, category, splitType, shares } =
    req.body;

  if (!groupId || !description || !amount)
    return res.status(400).json({ message: "Missing fields" });

  db.all(
    "SELECT user_id FROM group_members WHERE group_id = ?",
    [groupId],
    (err, members) => {
      if (err) return res.status(500).json({ message: err.message });

      const isMember = members.some((m) => m.user_id === req.userId);
      if (!isMember)
        return res.status(403).json({ message: "Not allowed" });

      let finalShares = shares || [];

      if (splitType === "equal") {
        const perHead =
          Math.round((amount / members.length) * 100) / 100;
        finalShares = members.map((m) => ({
          user: m.user_id,
          amount: perHead
        }));
      }

      const totalShares = finalShares.reduce(
        (sum, s) => sum + Number(s.amount),
        0
      );
      const roundedTotal = Math.round(totalShares * 100) / 100;
      const roundedAmount = Math.round(amount * 100) / 100;

      if (roundedTotal !== roundedAmount) {
        return res
          .status(400)
          .json({ message: "Shares total must equal amount" });
      }

      const now = new Date().toISOString();

      db.run(
        "INSERT INTO expenses (group_id, paid_by, description, amount, category, date, split_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          groupId,
          req.userId,
          description,
          roundedAmount,
          category || "other",
          now,
          splitType || "equal"
        ],
        function (err2) {
          if (err2) return res.status(500).json({ message: err2.message });
          const expenseId = this.lastID;

          finalShares.forEach((s) => {
            db.run(
              "INSERT INTO expense_shares (expense_id, user_id, amount) VALUES (?, ?, ?)",
              [expenseId, s.user, s.amount]
            );
          });

          res.status(201).json({
            id: expenseId,
            group_id: groupId,
            description,
            amount: roundedAmount,
            category: category || "other",
            date: now,
            split_type: splitType || "equal"
          });
        }
      );
    }
  );
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
