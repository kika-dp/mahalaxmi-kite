import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { SequenceService } from './sequence.service';

/** Global cross-cutting services: audit log and document numbering. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, SequenceService],
  exports: [AuditService, SequenceService],
})
export class AuditModule {}
