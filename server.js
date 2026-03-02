const express = require('express');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const dataDir = path.join(__dirname, 'data');
const climbsDir = path.join(dataDir, 'climbs');
const indexFile = path.join(dataDir, 'index.json');

fs.ensureDirSync(climbsDir);
if (!fs.existsSync(indexFile)) fs.writeJsonSync(indexFile, []);

// CREATE climb
app.post('/api/climbs', async (req, res) => {
  const id = uuidv4();
  const climb = { ...req.body, id };

  await fs.writeJson(path.join(climbsDir, `${id}.json`), climb, { spaces: 2 });

  const index = await fs.readJson(indexFile);
  index.push({ id, name: climb.name, grade: climb.grade, angle: climb.angle,  tags: climb.tags || [], features: climb.features || [] });
  await fs.writeJson(indexFile, index, { spaces: 2 });

  res.json({ id });
});

// UPDATE climb
app.put('/api/climbs/:id', async (req, res) => {
  const id = req.params.id;
  const file = path.join(climbsDir, `${id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });

  const climb = { ...req.body, id };
  await fs.writeJson(file, climb, { spaces: 2 });

  let index = await fs.readJson(indexFile);
  index = index.map(i => i.id === id ? { id, name: climb.name, grade: climb.grade, angle: climb.angle, tags: climb.tags || [], features: climb.features || []  } : i);
  await fs.writeJson(indexFile, index, { spaces: 2 });

  res.json({ success: true });
});

// GET index
app.get('/api/climbs', async (req, res) => {
  const index = await fs.readJson(indexFile);
  res.json(index);
});

// GET single climb
app.get('/api/climbs/:id', async (req, res) => {
  const file = path.join(climbsDir, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  const climb = await fs.readJson(file);
  res.json(climb);
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
