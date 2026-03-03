// ========================
// CUSTOM SELECT COMPONENT
// ========================
function createCustomSelect(containerId, optionsArray, initialValue) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const selected = document.createElement('div');
  selected.className = 'selected';
  selected.textContent = initialValue || optionsArray[0];
  const arrow = document.createElement('div'); arrow.className='arrow';
  selected.appendChild(arrow);

  const list = document.createElement('ul');
  optionsArray.forEach(opt=>{
    const li = document.createElement('li'); li.textContent=opt;
    li.onclick=()=>{
      selected.firstChild.textContent = opt;
      list.style.display='none';
      switchToCreateMode();
    };
    list.appendChild(li);
  });
  container.appendChild(selected);
  container.appendChild(list);

  selected.onclick = ()=>{
    list.style.display = (list.style.display==='block')?'none':'block';
  };
  return {getValue: ()=>selected.firstChild.textContent, setValue: val => selected.firstChild.textContent = val};
}

const gradeOptions = ['3','4','5A','5B','5C','6A','6B','6C','7A','7B','7C','8A'];
const angleOptions = []; for(let i=20;i<=60;i+=5) angleOptions.push(i.toString());
const rowsOptions = []; const colsOptions = [];
for(let i=3;i<=25;i++){ rowsOptions.push(i.toString()); colsOptions.push(i.toString()); }

const gradeSelectObj = createCustomSelect('gradeSelect', gradeOptions);
const angleSelectObj = createCustomSelect('angleSelect', angleOptions);
const rowsSelectObj = createCustomSelect('rowsSelect', rowsOptions, '16');
const colsSelectObj = createCustomSelect('colsSelect', colsOptions, '18');

// ========================
// TOGGLES
// ========================
function toggles(container, items){
  items.forEach(i=>{
    let b=document.createElement('button');
    b.textContent=i;
    b.className='toggle';
    b.onclick=()=>{
      b.classList.toggle('active');
      switchToCreateMode();
    };
    container.appendChild(b);
  });
}
toggles(tags, ['Crimpy','Slopers','Jugs','Compression','Dyno','Morpho','Old School']);
toggles(features, ['Campus only','No Matching','Crimp']);
toggles(feet, ['Black Pancakes','Big Black Feet','White Disks']);

// ========================
// LOCAL STORAGE / SAVED CLIMBS
// ========================
const nextBtn = document.getElementById('nextBtn');
let createMode = true;

function switchToCreateMode(){
  if (!createMode) {          
    createMode = true;
    nextBtn.textContent = 'Create Climb';
    document.getElementById('name').value='';
  }
}

function loadSavedClimbs() {
  const savedDiv = document.getElementById('savedClimbs');
  savedDiv.innerHTML = '';
  const saved = JSON.parse(localStorage.getItem('allClimbs') || '[]');

  saved.forEach((climb, index) => {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'space-between';
    wrapper.style.gap = '6px';

    // SELECT BUTTON
    const btn = document.createElement('button');
    btn.textContent = climb.name;
    btn.className = 'savedClimbBtn';
    btn.style.flex = '1';

    btn.onclick = () => {
      fillClimb(climb);
      createMode = false;
      nextBtn.textContent = 'Select Climb';
    };

    // DELETE BUTTON
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'deleteBtn';

    const fill = document.createElement('div');
    fill.className = 'fill';

    const icon = document.createElement('span');
    icon.textContent = '✕';

    deleteBtn.appendChild(fill);
    deleteBtn.appendChild(icon);

    let holdTimer;

    const startHold = () => {
      fill.style.width = '150%';
      fill.style.height = '150%';

      holdTimer = setTimeout(() => {
        saved.splice(index, 1);
        localStorage.setItem('allClimbs', JSON.stringify(saved));
        loadSavedClimbs();
      }, 1000);
    };

    const cancelHold = () => {
      clearTimeout(holdTimer);
      fill.style.transition = 'none';
      fill.style.width = '0%';
      fill.style.height = '0%';
      setTimeout(() => {
        fill.style.transition = 'width 1s linear, height 1s linear';
      }, 10);
    };

    // Mouse
    deleteBtn.addEventListener('mousedown', startHold);
    deleteBtn.addEventListener('mouseup', cancelHold);
    deleteBtn.addEventListener('mouseleave', cancelHold);

    // Touch
    deleteBtn.addEventListener('touchstart', startHold);
    deleteBtn.addEventListener('touchend', cancelHold);
    deleteBtn.addEventListener('touchcancel', cancelHold);

    wrapper.appendChild(btn);
    wrapper.appendChild(deleteBtn);
    savedDiv.appendChild(wrapper);
  });
}

document.getElementById('returnBtn').addEventListener('click', () => {
  window.location.href = 'profile.html';
});

function fillClimb(climb){
  document.getElementById('name').value = climb.name;
  gradeSelectObj.setValue(climb.grade);
  angleSelectObj.setValue(climb.angle);
  rowsSelectObj.setValue(climb.rows);
  colsSelectObj.setValue(climb.columns);

  ['tags','features','feet'].forEach(section=>{
    const container = document.getElementById(section);
    container.querySelectorAll('.toggle').forEach(btn=>{
      btn.classList.remove('active');
      if(climb[section].includes(btn.textContent)) btn.classList.add('active');
    });
  });
}

function continueWithClimb(climb){
  sessionStorage.setItem('draft', JSON.stringify(climb));
  console.log("Continuing with climb:", climb);
  //window.location.href = 'detection.html';
  sessionStorage.setItem('draft', JSON.stringify(climb));
  window.location.href = 'detection.html';  
}

function generateUUID() { 
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ========================
// CREATE / SELECT BUTTON
// ========================
nextBtn.addEventListener('click', ()=>{
  const climbName = document.getElementById('name').value.trim();

  if(createMode){
    if(!climbName){ alert('Enter a name'); return; }

    const climb = {
      id: generateUUID(), 
      name: climbName,
      grade: gradeSelectObj.getValue(),
      angle: angleSelectObj.getValue(),
      rows: parseInt(rowsSelectObj.getValue()),
      columns: parseInt(colsSelectObj.getValue()),
      tags: [...tags.querySelectorAll('.active')].map(b=>b.textContent),
      features: [...features.querySelectorAll('.active')].map(b=>b.textContent),
      feet: [...feet.querySelectorAll('.active')].map(b=>b.textContent),
      grid: Array(parseInt(rowsSelectObj.getValue())).fill().map(()=> 
              Array(parseInt(colsSelectObj.getValue())).fill(null))
    };

    const allClimbs = JSON.parse(localStorage.getItem('allClimbs') || '[]');
    allClimbs.push(climb);
    localStorage.setItem('allClimbs', JSON.stringify(allClimbs));
    loadSavedClimbs();

    console.log("Created climb:", climb); 
    //window.location.href = 'personal.html';
    sessionStorage.setItem('draft', JSON.stringify(climb));
    window.location.href = 'detection.html';  

  } else {
    const allClimbs = JSON.parse(localStorage.getItem('allClimbs') || '[]');
    const selected = allClimbs.find(c => c.name === climbName);
    if(selected) continueWithClimb(selected);
  }
});

// INITIAL LOAD
loadSavedClimbs();