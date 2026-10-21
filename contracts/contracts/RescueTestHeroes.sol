// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// Little Rescue hero NFTs, TESTNET ONLY (Base Sepolia). Ownership only: an NFT hero is never stronger than the
/// same hero earned in the game (no pay-to-win). Owning the NFT does not transfer any rights to the character art.
/// Every mint carries a claim ref that can be used once, so a retried server request never mints twice.
contract RescueTestHeroes is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public totalMinted;
    mapping(uint256 tokenId => string) public heroOf;
    mapping(bytes32 ref => bool) public usedRef;
    string private baseURI;

    error TestnetOnly(uint256 chainId);
    error RefUsed(bytes32 ref);
    error BadHero();

    event HeroMinted(address indexed to, uint256 indexed tokenId, string hero, bytes32 indexed ref);

    constructor(address admin, string memory baseURI_) ERC721("Little Rescue Test Heroes", "tLRH") {
        if (block.chainid != 84532 && block.chainid != 31337) revert TestnetOnly(block.chainid);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        baseURI = baseURI_;
    }

    function mint(address to, string calldata hero, bytes32 ref) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        if (usedRef[ref]) revert RefUsed(ref);
        if (bytes(hero).length == 0 || bytes(hero).length > 32) revert BadHero();
        usedRef[ref] = true;
        tokenId = ++totalMinted;
        heroOf[tokenId] = hero;
        _safeMint(to, tokenId);
        emit HeroMinted(to, tokenId, hero, ref);
    }

    /// <base>/<hero>.json, e.g. https://little-rescue.pages.dev/nft/sugar-01.json
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(baseURI, heroOf[tokenId], ".json");
    }

    function setBaseURI(string calldata baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseURI = baseURI_;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
