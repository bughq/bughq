import { defineModel } from '@stacksjs/orm'
import { makeHash } from '@stacksjs/security'
import { schema } from '@stacksjs/validation'

/**
 * Account owner. Auth is handled by the `useAuth` trait (password hashing,
 * session + token guards). Projects belong to a user via `owner_id`.
 */
export default defineModel({
  name: 'User',
  table: 'users',
  primaryKey: 'id',
  autoIncrement: true,

  hasMany: ['Subscription'],

  traits: {
    gdpr: { erasure: 'anonymize', basis: 'contract', purpose: 'User account and sign-in' },
    useAuth: {
      usePasskey: false,
    },
    billable: true,
    useTimestamps: true,
    useApi: {
      uri: 'users',
      routes: ['index', 'store', 'show'],
    },
  },

  attributes: {
    name: {
      personal: true,
      fillable: true,
      validation: {
        rule: schema.string().required().min(2).max(100),
        message: {
          min: 'Name must have at least 2 characters',
          max: 'Name must be at most 100 characters',
        },
      },
      factory: faker => faker.person.fullName(),
    },

    email: {
      personal: true,
      unique: true,
      fillable: true,
      validation: {
        rule: schema.string().email().required(),
        message: {
          required: 'Email is required',
          email: 'Email must be a valid email address',
        },
      },
      factory: faker => faker.internet.email(),
    },

    password: {
      hidden: true,
      fillable: true,
      validation: {
        rule: schema.string().required().min(8).max(255),
        message: {
          required: 'Password is required',
          min: 'Password must have at least 8 characters',
        },
      },
      factory: () => 'password123',
    },
  },

  set: {
    password: async (attributes: Record<string, any>) => {
      return await makeHash(attributes.password, { algorithm: 'bcrypt' })
    },
  },
})
