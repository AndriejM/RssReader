package pl.andriejsoft.rssreader.service;

import com.apptasticsoftware.rssreader.Item;
import com.apptasticsoftware.rssreader.RssReader;
import java.io.IOException;
import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import pl.andriejsoft.rssreader.dto.RssItemDto;
import pl.andriejsoft.rssreader.dto.UserConfigDto;
import pl.andriejsoft.rssreader.entity.RssItem;
import pl.andriejsoft.rssreader.entity.model.JobParams;
import pl.andriejsoft.rssreader.entity.model.RssConfig;
import pl.andriejsoft.rssreader.entity.model.RssItemPayload;
import pl.andriejsoft.rssreader.enums.RssItemStatus;
import pl.andriejsoft.rssreader.repository.RssItemRepository;

@Service
@Slf4j
public class RssLoaderService {

  @Autowired
  private UserConfigService userConfigService;

  @Autowired
  private RssItemRepository rssItemRepository;

  public RssItemDto getRssItemsById(Long id) {
    return rssItemRepository.findById(id).map(item -> RssItemDto.builder()
            .id(item.getId())
            .userId(item.getUserId())
            .groupUuid(item.getGroupUuid())
            .rssUuid(item.getRssUuid())
            .status(item.getStatus())
            .link(item.getLink())
            .pubDate(item.getPubDate())
            .itemPayload(item.getItemPayload())
            .build())
        .orElse(null);
  }

  public List<RssItemDto> getRssItemsForCurrentUser() {
    UserConfigDto userConfig = userConfigService.getCurrentUserConfig();
    return rssItemRepository.getByUserIdAndGroupUuidAndStatus(userConfig.getId(),
            userConfig.getUserConfigPayload().getGroups().get(0).getUuid(), RssItemStatus.NEW).stream()
        .map(item -> RssItemDto.builder()
            .id(item.getId())
            .rssUuid(item.getRssUuid())
            .groupUuid(item.getGroupUuid())
            .status(item.getStatus())
            .link(item.getLink())
            .pubDate(item.getPubDate())
            .build()).toList();
  }

  public void loadRss(JobParams jobParams) {
    loadRss(jobParams.getUserId(), jobParams.getGroupUuid(), jobParams.getRss());
  }

  public void loadRss(Long useId, String groupUuid, RssConfig rss) {
    RssReader rssReader = new RssReader();
    try {
      List<Item> items = rssReader.read(rss.getUrl()).toList();
      items.forEach(item -> {
        String link = item.getLink().orElse(null);
        if (rssItemRepository.findByLink(link).isEmpty()) {
          LocalDateTime pubDate = item.getPubDateZonedDateTime()
              .map(ZonedDateTime::toLocalDateTime).orElse(null);
          RssItemPayload rssItemPayload = RssItemPayload.builder()
              .title(item.getTitle().orElse(null))
              .link(link)
              .description(cleanDescription(item.getDescription().orElse(null)))
              .pubDate(pubDate)
              .build();
          RssItem rssItem = RssItem.builder()
              .userId(useId)
              .groupUuid(groupUuid)
              .itemUuid(rss.getUuid())
              .link(link)
              .pubDate(pubDate)
              .itemPayload(rssItemPayload)
              .build();
          rssItemRepository.save(rssItem);
        } else {
          log.info("Link {} is exists, skipped.", link);
        }
      });
    } catch (IOException e) {
      throw new RuntimeException(e);
    }
  }

  public void setReadStatusForExpiredItems(Long userId, LocalDateTime expiredDate) {
    rssItemRepository.setStatusByUserIdAndStatusAndPubDate(userId, RssItemStatus.NEW, expiredDate);
  }

  public void deleteForExpiredItems(Long userId, LocalDateTime expiredDate) {
    rssItemRepository.setStatusByUserIdAndStatusAndPubDate(userId, RssItemStatus.READ, expiredDate);
  }

  private String cleanDescription(String description) {
    if (description == null) {
      return null;
    }
    return description.trim().replaceAll("\\{", "[").replaceAll("}", "]");
  }
}
