package pl.andriejsoft.rssreader.repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import pl.andriejsoft.rssreader.entity.RssItem;
import pl.andriejsoft.rssreader.entity.RssItemProjection;
import pl.andriejsoft.rssreader.enums.RssItemStatus;

public interface RssItemRepository extends CrudRepository<RssItem, Long> {

  List<RssItem> findByUserIdAndGroupUuidAndStatus(Long userId, String groupUuid,
      RssItemStatus status);

  Optional<RssItem> findByLink(String link);

  List<RssItemProjection> getByUserIdAndGroupUuidAndStatus(Long userId, String groupUuid,
      RssItemStatus status);

  @Modifying
  @Query("update RssItem u set u.status = ?2 where u.userId = ?1 and u.pubDate < ?3")
  void setStatusByUserIdAndStatusAndPubDate(Long userId, RssItemStatus status,
      LocalDateTime pubDate);

  @Modifying
  @Query("delete RssItem u where u.userId = ?1 and u.status = ?2 and u.pubDate < ?3")
  void deleteByUserIdAndStatusAndPubDate(Long userId, RssItemStatus status,
      LocalDateTime pubDate);
}
