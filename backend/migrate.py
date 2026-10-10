import alembic.config
import os

if __name__ == "__main__":
    alembicArgs = [
        '--raiseerr',
        'revision', '--autogenerate', '-m', 'Initial_migration'
    ]
    alembic.config.main(argv=alembicArgs)
    
    alembicArgsUpgrade = [
        '--raiseerr',
        'upgrade', 'head'
    ]
    alembic.config.main(argv=alembicArgsUpgrade)
