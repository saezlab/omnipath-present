FROM postgres:18

# Two extensions are compiled/installed into the image:
#   * pg_roaringbitmap — built from source (no apt package).
#   * rdkit            — the RDKit cheminformatics cartridge, from the PGDG apt
#     repository (postgresql-18-rdkit). Used only by the omnipath-metabo
#     post-build chemistry layer; the main omnipath-build database builds fine
#     without `CREATE EXTENSION rdkit`.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg build-essential git postgresql-server-dev-18; \
    # --- RDKit cartridge from the PostgreSQL APT (PGDG) repository ---
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    . /etc/os-release; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-18-rdkit; \
    # --- pg_roaringbitmap from source ---
    git clone --depth 1 https://github.com/ChenHuajun/pg_roaringbitmap.git; \
    cd pg_roaringbitmap; \
    make; \
    make install; \
    cd ..; \
    rm -rf pg_roaringbitmap; \
    # --- shrink: drop build toolchain (RDKit runtime libs are kept as deps) ---
    apt-get purge -y --auto-remove build-essential git postgresql-server-dev-18 gnupg; \
    rm -rf /var/lib/apt/lists/*
