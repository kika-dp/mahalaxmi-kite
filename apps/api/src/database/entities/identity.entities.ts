import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Role } from '@kite/shared';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'citext', unique: true }) username: string;
  @Column({ type: 'citext', unique: true }) email: string;
  @Column({ type: 'varchar', length: 100 }) fullName: string;
  @Column({ type: 'varchar', length: 15, nullable: true }) phone: string | null;
  @Column({ type: 'varchar', length: 20 }) role: Role;
  @Column({ type: 'text', select: false }) passwordHash: string;
  @Column({ type: 'boolean', default: true }) mustChangePassword: boolean;
  @Column({ type: 'boolean', default: true }) isActive: boolean;
  @Column({ type: 'int', nullable: true }) maxDiscountBps: number | null;
  @Column({ type: 'int', default: 0 }) failedLoginCount: number;
  @Column({ type: 'timestamptz', nullable: true }) lockedUntil: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) lastLoginAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) passwordChangedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('user_sessions')
export class UserSession {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User;
  @Column('uuid') familyId: string;
  @Column({ type: 'char', length: 64, unique: true }) refreshTokenHash: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) revokedReason: string | null;
  @Column({ type: 'uuid', nullable: true }) replacedById: string | null;
  @Column({ type: 'boolean', default: false }) remember: boolean;
  @Column({ type: 'varchar', length: 255, nullable: true }) userAgent: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) ip: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) lastUsedAt: Date | null;
}

@Entity('shop_settings')
export class ShopSettingsEntity {
  @PrimaryColumn({ type: 'int', default: 1 }) id: number;
  @Column({ type: 'varchar', length: 120 }) shopName: string;
  @Column({ type: 'text', default: '' }) address: string;
  @Column({ type: 'varchar', length: 20, default: '' }) phone: string;
  @Column({ type: 'varchar', length: 120, nullable: true }) email: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) logoUrl: string | null;
  @Column({ type: 'varchar', length: 7, default: '#F97316' }) brandColor: string;
  @Column({ type: 'varchar', length: 10, default: 'KITE' }) invoicePrefix: string;
  @Column({ type: 'varchar', length: 40, default: 'Invoice' }) invoiceTitle: string;
  @Column({ type: 'text', nullable: true }) invoiceFooter: string | null;
  @Column({ type: 'boolean', default: false }) taxEnabled: boolean;
  @Column({ type: 'varchar', length: 20, default: 'GST' }) taxLabel: string;
  @Column({ type: 'int', default: 0 }) taxRateBps: number;
  @Column({ type: 'varchar', length: 15, nullable: true }) gstin: string | null;
  @Column({ type: 'int', default: 1000 }) salespersonMaxDiscountBps: number;
  @Column({ type: 'int', default: 10 }) defaultMinStockAlert: number;
  @Column({ type: 'boolean', default: false }) requireCustomerPhoneForCredit: boolean;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
  @Column({ type: 'uuid', nullable: true }) updatedBy: string | null;
}

@Entity('seasons')
export class SeasonEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 60, unique: true }) name: string;
  @Column({ type: 'varchar', length: 20, unique: true }) code: string;
  @Column({ type: 'date' }) startsOn: string;
  @Column({ type: 'date' }) endsOn: string;
  @Column({ type: 'varchar', length: 10 }) invoiceSeries: string;
  @Column({ type: 'boolean', default: false }) isActive: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ type: 'uuid', nullable: true }) actorId: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) actorUsername: string | null;
  @Column({ type: 'varchar', length: 50 }) action: string;
  @Column({ type: 'varchar', length: 40, nullable: true }) entityType: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) entityId: string | null;
  @Column({ type: 'jsonb', nullable: true }) before: unknown;
  @Column({ type: 'jsonb', nullable: true }) after: unknown;
  @Column({ type: 'jsonb', nullable: true }) metadata: unknown;
  @Column({ type: 'varchar', length: 64, nullable: true }) ip: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) requestId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('document_sequences')
export class DocumentSequence {
  @PrimaryColumn({ type: 'varchar', length: 40 }) key: string;
  @Column({ type: 'bigint', default: 0 }) lastValue: string;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
