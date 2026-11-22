import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionCacheService } from './session-cache.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionCacheService],
  exports: [AuthService, PasswordService, SessionCacheService, JwtModule],
})
export class AuthModule {}
