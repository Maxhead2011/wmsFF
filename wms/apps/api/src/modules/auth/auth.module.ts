import { Module } from '@nestjs/common';
import { AccessModelService } from './access-model.service';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClientScopeService } from './client-scope.service';
import { PrinterScopeService } from './printer-scope.service';
import { AuthGuard } from './guards/auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { PasswordService } from './password.service';
import { UserSessionService } from './user-session.service';
import { WarehouseAuthScopeService } from './warehouse-auth-scope.service';

@Module({
  controllers: [AuthController],
  providers: [
    AccessModelService,
    AccessTokenService,
    AuthService,
    AuthGuard,
    ClientScopeService,
    PrinterScopeService,
    PasswordService,
    PermissionsGuard,
    UserSessionService,
    WarehouseAuthScopeService,
  ],
  exports: [
    AccessModelService,
    AccessTokenService,
    AuthService,
    AuthGuard,
    ClientScopeService,
    PrinterScopeService,
    PasswordService,
    PermissionsGuard,
    UserSessionService,
    WarehouseAuthScopeService,
  ],
})
export class AuthModule {}
