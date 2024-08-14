#!/bin/bash

# Define the client directory array
clients=("synchronizer" "validator")

# Function to compare version numbers
version_ge() {
    # Compare two version strings
    # Returns 0 if \$1 >= \$2, 1 otherwise
    [ "\$1" = "\$2" ] && return 0
    local IFS=.
    local i ver1=(\$1) ver2=(\$2)
    # Fill empty fields in ver1 with zeros
    for ((i=${#ver1[@]}; i<${#ver2[@]}; i++)); do
        ver1[i]=0
    done
    for ((i=0; i<${#ver1[@]}; i++)); do
        if [[ -z ${ver2[i]} ]]; then
            # Fill empty fields in ver2 with zeros
            ver2[i]=0
        fi
        if ((10#${ver1[i]} > 10#${ver2[i]})); then
            return 0
        fi
        if ((10#${ver1[i]} < 10#${ver2[i]})); then
            return 1
        fi
    done
    return 0
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js version 20.15 or higher."
    exit 1
fi

# Get the installed Node.js version
node_version=$(node -v | sed 's/v//')

# Required Node.js version
required_version="20.15.0"

# Compare installed version with required version
if ! version_ge "$node_version" "$required_version"; then
    echo "Node.js version $node_version is installed. Please install Node.js version 20.15 or higher."
    exit 1
fi

# Check if corepack is installed
if ! command -v corepack &> /dev/null; then
    echo "Corepack is not installed. Installing Corepack..."
    npm install -g corepack || { echo "Failed to install Corepack"; exit 1; }
fi

# Check if yarn is installed
if ! command -v yarn &> /dev/null; then
    echo "Yarn is not installed. Installing Yarn using Corepack..."
    corepack enable || { echo "Failed to enable Corepack"; exit 1; }
    corepack prepare yarn@stable --activate || { echo "Failed to install Yarn"; exit 1; }
    echo "Yarn installed successfully."
else
    echo "Yarn is already installed."
fi

# Display the entry menu
echo "Please select the client to start:"
select client in "${clients[@]}"; do
  if [[ -n "$client" ]]; then
    echo "You selected $client"
    break
  else
    echo "Invalid choice, please select again."
  fi
done

# Enter the corresponding subdirectory
cd "$client" || { echo "Failed to enter directory $client"; exit 1; }

# Check if .env file exists, if not, copy .env.example to .env
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo ".env file not found, copying .env.example to .env"
    cp .env.example .env || { echo "Failed to copy .env.example to .env"; exit 1; }
  else
    echo ".env.example file not found, please create a .env file manually."
    exit 1
  fi
else
  echo ".env file already exists."
fi

# Check if dependencies are installed
echo "Check Dependencies"
yarn install || { echo "Dependency installation failed"; exit 1; }

# Start the client script
echo "Starting $client..."
yarn start || { echo "$client failed to start"; exit 1; }

echo "$client started successfully."
