# Stage 1: Build
FROM node:18-bookworm AS build

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy the rest of the application source code
COPY . .

# Build the Vue.js app
RUN yarn build

# Stage 2: Serve with Nginx
FROM node:18-bookworm AS production

# Install Nginx
RUN apt-get update && apt-get install -y nginx

# Remove default Nginx website and add Vue app
# RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
