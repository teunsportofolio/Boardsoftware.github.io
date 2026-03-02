# Boardsoftware.github.io
Server to save routes and stuff
install node.js before trying. 1️⃣ Install Node.js (if not installed)

Download and install from:
https://nodejs.org

After installing, verify, by opening command prompt on computer: Alt R -> cmd:
node -v
npm -v

Both should print version numbers.

2️⃣ Create Project Folder

Create a folder:

mkdir climb-app
cd climb-app

Inside it, create:

server.js
package.json
data/
public/

Inside data/ create:

climbs/
3️⃣ Install Dependencies

Run inside the project root:

npm install

This reads package.json and installs:

express

fs-extra

uuid

If you ever need to manually install:

npm install express fs-extra uuid
4️⃣ Start Server
npm start

You should see:

Server running on http://localhost:3000
5️⃣ Open In Browser

Go to:

http://localhost:3000/page1.html
