#!/bin/bash
export NVM_DIR="/home/nico/.nvm"
source "$NVM_DIR/nvm.sh"
exec /home/nico/.nvm/versions/node/v24.16.0/bin/serve /home/nico/cronogramav2/dist -l 3000
