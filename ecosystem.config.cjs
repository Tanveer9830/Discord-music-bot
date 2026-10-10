module.exports = {
  apps: [
    {
      name: "tanveer-prime-music",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: "10s",
      max_memory_restart: "512M",
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
        DEPLOYMENT_MODE: "pm2",
      },
    },
  ],
};
