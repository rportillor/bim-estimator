{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.nodePackages.typescript-language-server
    pkgs.postgresql
    pkgs.openssl
    pkgs.pkg-config
    pkgs.libuuid
  ];
}
