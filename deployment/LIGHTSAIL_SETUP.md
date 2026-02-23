# Lightsail Server Setup — WildMind AI

## 1. Set GitHub Secrets (per repo)

Go to each repo → **Settings → Secrets → Actions** and add:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM key with ECR push/pull permissions |
| `AWS_SECRET_ACCESS_KEY` | Matching secret |
| `LIGHTSAIL_HOST` | Your Lightsail static IP |
| `LIGHTSAIL_USER` | `ubuntu` |
| `LIGHTSAIL_SSH_KEY` | Lightsail SSH private key (PEM) |
| `NEXT_PUBLIC_API_BASE_URL` | `https://dev-api.wildmindai.com` *(wild only)* |
| `NEXT_PUBLIC_CANVAS_URL` | `https://onstaging-studios.wildmindai.com` *(wild only)* |
| `NEXT_PUBLIC_API_URL` | `https://dev-api.wildmindai.com` *(wildmindcanvas only)* |

---

## 2. First-Time Server Setup

SSH into your Lightsail instance and run:

```bash
# Install Docker
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
newgrp docker

# Install AWS CLI
sudo apt install -y awscli

# Add 2 GB swap (prevents OOM during pulls)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 3. Create ECR Repositories

Run this from your local machine (once):

```bash
for repo in wild wildmindcanvas api-gateway credit-service; do
  aws ecr create-repository \
    --repository-name $repo \
    --region ap-south-1 \
    --image-scanning-configuration scanOnPush=true
done
```

---

## 4. Clone Repos on Server

```bash
mkdir ~/wildmind-staging && cd ~/wildmind-staging

git clone -b staging git@github.com:YOUR_ORG/api-gateway-services-wildmind.git
git clone -b staging git@github.com:YOUR_ORG/wild.git
git clone -b staging git@github.com:YOUR_ORG/wildmindcanvas.git
git clone -b staging git@github.com:YOUR_ORG/credit-service.git
```

---

## 5. Add .env.production

```bash
nano ~/wildmind-staging/api-gateway-services-wildmind/deployment/.env.production
# Paste all env vars from your Contabo .env.production
```

---

## 6. SSL Certificates (Certbot)

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone \
  -d dev-api.wildmindai.com \
  -d onstaging.wildmindai.com \
  -d onstaging-studios.wildmindai.com

# Link to expected path
mkdir -p ~/wildmind-staging/certbot/conf
sudo ln -s /etc/letsencrypt ~/wildmind-staging/certbot/conf/live
```

---

## 7. First Deployment

```bash
cd ~/wildmind-staging/api-gateway-services-wildmind/deployment/
chmod +x deploy.sh
./deploy.sh all
```

---

## 8. IAM Policy for ECR (attach to your CI/CD IAM user)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": "arn:aws:ecr:ap-south-1:213128717650:repository/*"
    },
    {
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    }
  ]
}
```
