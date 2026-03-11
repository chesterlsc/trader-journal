FROM php:8.3-cli-alpine

RUN apk add --no-cache postgresql-dev && docker-php-ext-install pdo_pgsql

WORKDIR /app

COPY . /app

EXPOSE 8080

CMD ["sh", "-c", "php -S 0.0.0.0:${PORT:-8080} -t /app"]
