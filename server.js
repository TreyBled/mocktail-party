const express = require('express');
const cors = require('cors');
const path = require('path');
const { query, run } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serve static files (HTML, CSS, JS)

// ---------- INGREDIENT ENDPOINTS ----------
// Get all wet ingredients
app.get('/api/ingredients/wet', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM wet_ingredients ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all dry ingredients
app.get('/api/ingredients/dry', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM dry_ingredients ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle ingredient active status (wet or dry)
app.put('/api/ingredients/:type/:id/toggle', async (req, res) => {
  const { type, id } = req.params;
  const table = type === 'wet' ? 'wet_ingredients' : 'dry_ingredients';
  try {
    // Get current status
    const rows = await query(`SELECT is_active FROM ${table} WHERE id = ?`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Ingredient not found' });
    const newStatus = rows[0].is_active ? 0 : 1;
    await run(`UPDATE ${table} SET is_active = ? WHERE id = ?`, [newStatus, id]);
    res.json({ success: true, is_active: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new ingredient (wet or dry)
app.post('/api/ingredients/:type', async (req, res) => {
  const { type } = req.params;
  const { name, unit } = req.body;
  const table = type === 'wet' ? 'wet_ingredients' : 'dry_ingredients';
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const result = await run(`INSERT INTO ${table} (name, unit, is_active) VALUES (?, ?, 1)`, [name, unit || '']);
    res.status(201).json({ id: result.lastID, name, unit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- DRINK ENDPOINTS ----------
// Get all drinks with their ingredients
app.get('/api/drinks', async (req, res) => {
  try {
    const drinks = await query('SELECT * FROM drinks ORDER BY name');
    for (let drink of drinks) {
      const ingredients = await query(`
        SELECT di.ingredient_type, di.ingredient_id, di.quantity,
               CASE WHEN di.ingredient_type = 'wet' THEN wi.name ELSE di2.name END as name
        FROM drink_ingredients di
        LEFT JOIN wet_ingredients wi ON di.ingredient_type = 'wet' AND di.ingredient_id = wi.id
        LEFT JOIN dry_ingredients di2 ON di.ingredient_type = 'dry' AND di.ingredient_id = di2.id
        WHERE di.drink_id = ?
      `, [drink.id]);
      drink.ingredients = ingredients;
    }
    res.json(drinks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get only available drinks (all ingredients active)
app.get('/api/available-drinks', async (req, res) => {
  try {
    const drinks = await query('SELECT * FROM drinks ORDER BY name');
    const available = [];
    for (let drink of drinks) {
      const ingredients = await query(`
        SELECT di.ingredient_type, di.ingredient_id, di.quantity,
               CASE WHEN di.ingredient_type = 'wet' THEN wi.is_active ELSE di2.is_active END as is_active
        FROM drink_ingredients di
        LEFT JOIN wet_ingredients wi ON di.ingredient_type = 'wet' AND di.ingredient_id = wi.id
        LEFT JOIN dry_ingredients di2 ON di.ingredient_type = 'dry' AND di.ingredient_id = di2.id
        WHERE di.drink_id = ?
      `, [drink.id]);
      // If any ingredient is inactive or missing, drink is not available
      const allActive = ingredients.every(ing => ing.is_active === 1);
      if (allActive && ingredients.length > 0) {
        // Re‑attach ingredient names for display
        const fullIngredients = await query(`
          SELECT di.ingredient_type, di.quantity,
                 CASE WHEN di.ingredient_type = 'wet' THEN wi.name ELSE di2.name END as name
          FROM drink_ingredients di
          LEFT JOIN wet_ingredients wi ON di.ingredient_type = 'wet' AND di.ingredient_id = wi.id
          LEFT JOIN dry_ingredients di2 ON di.ingredient_type = 'dry' AND di.ingredient_id = di2.id
          WHERE di.drink_id = ?
        `, [drink.id]);
        drink.ingredients = fullIngredients;
        available.push(drink);
      }
    }
    res.json(available);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new drink (with its ingredients)
app.post('/api/drinks', async (req, res) => {
  const { name, description, instructions, ingredients } = req.body;
  if (!name || !ingredients || !Array.isArray(ingredients)) {
    return res.status(400).json({ error: 'Name and ingredients array required' });
  }
  try {
    // Insert drink
    const result = await run(
      'INSERT INTO drinks (name, description, instructions) VALUES (?, ?, ?)',
      [name, description || '', instructions || '']
    );
    const drinkId = result.lastID;
    // Insert each ingredient
    for (let ing of ingredients) {
      const { type, id, quantity } = ing;
      if (!type || !id) continue;
      await run(
        'INSERT INTO drink_ingredients (drink_id, ingredient_type, ingredient_id, quantity) VALUES (?, ?, ?, ?)',
        [drinkId, type, id, quantity || '']
      );
    }
    res.status(201).json({ id: drinkId, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- ORDER ENDPOINTS ----------
// Create an order
app.post('/api/orders', async (req, res) => {
  const { drink_id } = req.body;
  if (!drink_id) return res.status(400).json({ error: 'drink_id required' });
  try {
    const result = await run('INSERT INTO orders (drink_id) VALUES (?)', [drink_id]);
    res.status(201).json({ id: result.lastID, drink_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all pending orders (with drink name)
app.get('/api/orders/pending', async (req, res) => {
  try {
    const rows = await query(`
      SELECT o.id, o.drink_id, o.created_at, d.name as drink_name
      FROM orders o
      JOIN drinks d ON o.drink_id = d.id
      WHERE o.status = 'pending'
      ORDER BY o.created_at ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark order as completed
app.put('/api/orders/:id/complete', async (req, res) => {
  const { id } = req.params;
  try {
    await run('UPDATE orders SET status = "completed" WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve the two pages
app.get('/bartender', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'bartender.html'));
});
app.get('/menu', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'menu.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Bartender: http://localhost:${PORT}/bartender`);
  console.log(`Menu:      http://localhost:${PORT}/menu`);
});