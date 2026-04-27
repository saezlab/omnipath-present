FROM postgres:18
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates build-essential git postgresql-server-dev-18 \
  && git clone --depth 1 https://github.com/ChenHuajun/pg_roaringbitmap.git \
  && cd pg_roaringbitmap \
  && make \
  && make install \
  && cd .. \
  && rm -rf pg_roaringbitmap \
  && apt-get remove -y build-essential git \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
