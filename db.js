const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB ulanish funksiyasi
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MongoDB URI topilmadi. .env faylni tekshiring');
    }
    
    // Warning yechish uchun optionlar
    const options = {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    };
    
    await mongoose.connect(mongoURI, options);
    console.log('✅ MongoDB ga muvaffaqiyatli ulandi');
    
    return mongoose.connection;
  } catch (error) {
    console.error('❌ MongoDB ga ulanishda xato:', error.message);
    
    // SQLite ga fallback
    console.log('⚠️ MongoDB ulanishi muvaffaqiyatsiz, SQLite ga qaytildi');
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    
    const db = new sqlite3.Database(path.join(__dirname, 'expenses.db'));
    
    // SQLite jadvalini yaratish
    db.run(`CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    return db;
  }
};

// MongoDB Schema va Model
const expenseSchema = new mongoose.Schema({
  user_id: {
    type: Number,
    required: true,
    index: true
  },
  category: {
    type: String,
    required: true
  },
  description: {
    type: String,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

// Indexlar
expenseSchema.index({ user_id: 1, date: -1 });
expenseSchema.index({ user_id: 1, category: 1 });

const Expense = mongoose.model('Expense', expenseSchema);

// Database operatsiyalari
const Database = {
  // Harajat qo'shish
  addExpense: async (userId, category, description, amount, date) => {
    const connection = await connectDB();
    
    if (connection instanceof mongoose.Connection) {
      // MongoDB
      try {
        const expense = new Expense({
          user_id: userId,
          category,
          description,
          amount,
          date: new Date(date)
        });
        
        return await expense.save();
      } catch (error) {
        console.error('Harajat qoʻshish xatosi:', error);
        throw error;
      }
    } else {
      // SQLite
      return new Promise((resolve, reject) => {
        connection.run(
          `INSERT INTO expenses (user_id, category, description, amount, date)
           VALUES (?, ?, ?, ?, ?)`,
          [userId, category, description, amount, date],
          function(err) {
            if (err) {
              reject(err);
            } else {
              resolve({ id: this.lastID });
            }
          }
        );
      });
    }
  },
  
  // Oxirgi harajat
  getLastExpense: async (userId) => {
    const connection = await connectDB();
    
    if (connection instanceof mongoose.Connection) {
      // MongoDB
      try {
        return await Expense.findOne({ user_id: userId })
          .sort({ created_at: -1 })
          .limit(1)
          .lean();
      } catch (error) {
        console.error('Oxirgi harajatni olish xatosi:', error);
        throw error;
      }
    } else {
      // SQLite
      return new Promise((resolve, reject) => {
        connection.get(
          `SELECT id, category, description, amount, date 
           FROM expenses 
           WHERE user_id = ? 
           ORDER BY id DESC LIMIT 1`,
          [userId],
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row);
            }
          }
        );
      });
    }
  },
  
  // Harajatni o'chirish
  deleteExpense: async (id, userId) => {
    const connection = await connectDB();
    
    if (connection instanceof mongoose.Connection) {
      // MongoDB
      try {
        const result = await Expense.deleteOne({ 
          _id: id, 
          user_id: userId 
        });
        return result.deletedCount;
      } catch (error) {
        console.error('Harajat o\'chirish xatosi:', error);
        throw error;
      }
    } else {
      // SQLite
      return new Promise((resolve, reject) => {
        connection.run(
          `DELETE FROM expenses WHERE id = ? AND user_id = ?`,
          [id, userId],
          function(err) {
            if (err) {
              reject(err);
            } else {
              resolve(this.changes);
            }
          }
        );
      });
    }
  },
  
  // Harajatlar soni
  getExpensesCount: async (userId) => {
    const connection = await connectDB();
    
    if (connection instanceof mongoose.Connection) {
      // MongoDB
      try {
        return await Expense.countDocuments({ user_id: userId });
      } catch (error) {
        console.error('Harajatlar sonini olish xatosi:', error);
        throw error;
      }
    } else {
      // SQLite
      return new Promise((resolve, reject) => {
        connection.get(
          `SELECT COUNT(*) as total FROM expenses WHERE user_id = ?`, 
          [userId], 
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row ? row.total : 0);
            }
          }
        );
      });
    }
  },
  
  // Pagination bilan harajatlar
  getPaginatedExpenses: async (userId, limit, offset) => {
    const connection = await connectDB();
    
    if (connection instanceof mongoose.Connection) {
      // MongoDB
      try {
        return await Expense.find({ user_id: userId })
          .sort({ date: -1, created_at: -1 })
          .skip(offset)
          .limit(limit)
          .lean();
      } catch (error) {
        console.error('Pagination bilan harajat olish xatosi:', error);
        throw error;
      }
    } else {
      // SQLite
      return new Promise((resolve, reject) => {
        connection.all(
          `SELECT id, date, category, description, amount
           FROM expenses
           WHERE user_id = ?
           ORDER BY date DESC, id DESC
           LIMIT ? OFFSET ?`,
          [userId, limit, offset],
          (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows);
            }
          }
        );
      });
    }
  },
  
  // Davr bo'yicha hisobot
  getPeriodReport: async (userId, startDate, endDate = null) => {
    const connection = await connectDB();
    
    if (connection instanceof mongoose.Connection) {
      // MongoDB
      try {
        const query = { 
          user_id: userId, 
          date: { $gte: new Date(startDate) } 
        };
        
        if (endDate) {
          query.date.$lte = new Date(endDate);
        }
        
        return await Expense.find(query)
          .sort({ date: -1, created_at: -1 })
          .lean();
      } catch (error) {
        console.error('Hisobot olish xatosi:', error);
        throw error;
      }
    } else {
      // SQLite
      return new Promise((resolve, reject) => {
        let query = `SELECT id, date, category, description, amount
                     FROM expenses
                     WHERE user_id = ? AND date >= ?`;
        let params = [userId, startDate];
        
        if (endDate) {
          query += ` AND date <= ?`;
          params.push(endDate);
        }
        
        query += ` ORDER BY date DESC, id DESC`;
        
        connection.all(query, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    }
  }
};

// Ulanishni boshlash
let dbType = 'unknown';

connectDB().then((connection) => {
  if (connection instanceof mongoose.Connection) {
    dbType = 'mongodb';
    console.log('📊 MongoDB ishlatilmoqda');
  } else {
    dbType = 'sqlite';
    console.log('💾 SQLite ishlatilmoqda');
  }
}).catch(err => {
  console.error('Ulanish xatosi:', err);
});

module.exports = { Database };