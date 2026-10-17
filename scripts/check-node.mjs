const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || major === 22 && minor < 12) {
  console.error(`Occlude needs Node.js 22.12 or newer. You are running ${process.version}.`)
  console.error('From this repository, run: nvm install 24 && nvm use 24 && npm ci')
  process.exit(1)
}
