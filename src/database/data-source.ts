import 'dotenv/config';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { ContactRequest } from '../contact/entities/contact-request.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Site } from '../sites/entities/site.entity.js';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'emailservice',
  password: process.env.DB_PASS ?? 'emailservice',
  database: process.env.DB_NAME ?? 'emailservice',
  entities: [ContactRequest, User, Site],
  migrations: ['dist/database/migrations/*.js'],
  migrationsRun: false,
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
