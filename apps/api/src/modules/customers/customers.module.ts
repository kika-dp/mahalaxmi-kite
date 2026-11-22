import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({ imports: [InvoicesModule], controllers: [CustomersController], providers: [CustomersService] })
export class CustomersModule {}
