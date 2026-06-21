// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.0.2/contracts/access/Ownable.sol";

interface IPixelTripStage1 {
    function burn(uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

/// @title Pixel Trip — In-Place Evolve Contract v2
/// @notice Burns one Stage 1 token, upgrades the other in-place.
///         No new tokens are minted. Stage is tracked in this contract's storage.
///         The original collection's tokenURI must point to a metadata endpoint
///         that reads evolvedStage() from this contract.
///
///   Evolution rules:
///     Blocked    — 1-of-1 characters, cannot evolve
///     Normal     — count >= 3: S1+S1→S2 ; S2+S2→S3
///     DirectToS3 — count = 2:  S1+S1→S3  (skip S2)
contract EvolvePixelTrip is Ownable {

    enum EvoPath { Blocked, Normal, DirectToS3 }

    // ── Storage ───────────────────────────────────────────────────────────────

    IPixelTripStage1 public immutable STAGE1_COLLECTION;

    /// Stage of a token (0 = original Stage 1, 2 = evolved Stage 2, 3 = Stage 3)
    mapping(uint256 => uint8) public evolvedStage;

    /// charId for each Stage 1 token
    mapping(uint256 => uint8) public stage1Character;

    /// evolution path per charId
    mapping(uint8 => EvoPath) public characterPath;

    bool    public evolveActive = true;
    uint256 public totalEvolved;

    // ── Events ────────────────────────────────────────────────────────────────

    event Evolved(
        address indexed user,
        uint256 indexed keepTokenId,
        uint256         burnTokenId,
        uint8           newStage,
        uint8           charId
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address stage1Collection) Ownable(msg.sender) {
        STAGE1_COLLECTION = IPixelTripStage1(stage1Collection);
    }

    // ── Owner: configuration ──────────────────────────────────────────────────

    function setStage1Characters(
        uint256[] calldata tokenIds,
        uint8[]   calldata charIds
    ) external onlyOwner {
        require(tokenIds.length == charIds.length, "length mismatch");
        for (uint256 i = 0; i < tokenIds.length; i++) {
            stage1Character[tokenIds[i]] = charIds[i];
        }
    }

    function setCharacterPaths(
        uint8[] calldata charIds,
        uint8[] calldata paths
    ) external onlyOwner {
        require(charIds.length == paths.length, "length mismatch");
        for (uint256 i = 0; i < charIds.length; i++) {
            require(paths[i] <= 2, "invalid path");
            characterPath[charIds[i]] = EvoPath(paths[i]);
        }
    }

    function setEvolveActive(bool active) external onlyOwner {
        evolveActive = active;
    }

    // ── Evolve Stage 1 → Stage 2 (or Stage 3 for DirectToS3) ─────────────────

    /// @param keepId  Token that will be upgraded (stays in wallet, metadata changes)
    /// @param burnId  Token that will be destroyed permanently
    function evolveFromStage1(uint256 keepId, uint256 burnId) external {
        require(evolveActive, "evolve paused");
        require(keepId != burnId, "same token");

        require(STAGE1_COLLECTION.ownerOf(keepId) == msg.sender, "not owner of keep token");
        require(STAGE1_COLLECTION.ownerOf(burnId) == msg.sender, "not owner of burn token");
        require(
            STAGE1_COLLECTION.isApprovedForAll(msg.sender, address(this)),
            "approve this contract on Stage 1 collection first"
        );

        require(evolvedStage[keepId] == 0, "keep token already evolved");
        require(evolvedStage[burnId] == 0, "burn token already evolved");

        uint8 charKeep = stage1Character[keepId];
        uint8 charBurn = stage1Character[burnId];
        require(charKeep == charBurn, "character mismatch");

        EvoPath path = characterPath[charKeep];
        require(path != EvoPath.Blocked, "this character cannot evolve (1-of-1)");

        STAGE1_COLLECTION.burn(burnId);

        uint8 newStage = (path == EvoPath.DirectToS3) ? 3 : 2;
        evolvedStage[keepId] = newStage;
        totalEvolved++;

        emit Evolved(msg.sender, keepId, burnId, newStage, charKeep);
    }

    // ── Evolve Stage 2 → Stage 3 ──────────────────────────────────────────────

    /// @param keepId  Stage 2 token that will become Stage 3
    /// @param burnId  Stage 2 token that will be destroyed
    function evolveFromStage2(uint256 keepId, uint256 burnId) external {
        require(evolveActive, "evolve paused");
        require(keepId != burnId, "same token");

        require(STAGE1_COLLECTION.ownerOf(keepId) == msg.sender, "not owner of keep token");
        require(STAGE1_COLLECTION.ownerOf(burnId) == msg.sender, "not owner of burn token");
        require(
            STAGE1_COLLECTION.isApprovedForAll(msg.sender, address(this)),
            "approve this contract on Stage 1 collection first"
        );

        require(evolvedStage[keepId] == 2, "keep token is not Stage 2");
        require(evolvedStage[burnId] == 2, "burn token is not Stage 2");

        uint8 charKeep = stage1Character[keepId];
        uint8 charBurn = stage1Character[burnId];
        require(charKeep == charBurn, "character mismatch");

        STAGE1_COLLECTION.burn(burnId);
        evolvedStage[burnId] = 0; // clear (burned)
        evolvedStage[keepId] = 3;
        totalEvolved++;

        emit Evolved(msg.sender, keepId, burnId, 3, charKeep);
    }
}
